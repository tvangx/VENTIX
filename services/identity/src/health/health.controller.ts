import { Controller, Get } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Public } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { DbHealthService } from "../db/db-health.service";

class HealthResponse {
  @ApiProperty({ example: "ok" })
  status!: string;
}

const READY_TIMEOUT_MS = 2000;

@ApiTags("health")
@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly db: DbHealthService) {}

  @Get("live")
  @ApiOperation({ summary: "Process is up" })
  @ApiOkResponse({ type: HealthResponse })
  live(): HealthResponse {
    return { status: "ok" };
  }

  @Get("ready")
  @ApiOperation({ summary: "Ready to serve traffic (checks the database)" })
  @ApiOkResponse({ type: HealthResponse })
  @ApiServiceUnavailableResponse({
    description: "Database unreachable (problem+json, code NOT_READY)",
  })
  async ready(): Promise<HealthResponse> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.db.ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("db ping timeout")), READY_TIMEOUT_MS);
        }),
      ]);
      return { status: "ok" };
    } catch {
      throw new ProblemException("NOT_READY", 503, "Database unavailable");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
