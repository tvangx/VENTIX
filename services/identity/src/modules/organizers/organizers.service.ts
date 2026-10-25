import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { AccessService } from "../access/access.service";
import { IdempotencyService } from "../auth/idempotency.service";
import { DocumentsStorage, LicenseFile, licenseExtension } from "./documents.storage";
import { OrganizerApplicationDto, OrganizerDecisionDto, OrganizerListDto } from "./organizers.dto";
import { applicationResponse, OrganizersRepository } from "./organizers.repository";

@Injectable()
export class OrganizersService {
  constructor(
    private readonly repository: OrganizersRepository,
    private readonly access: AccessService,
    private readonly idempotency: IdempotencyService,
    private readonly storage: DocumentsStorage,
  ) {}
  async apply(userId: string, dto: OrganizerApplicationDto, key?: string) {
    await this.access.me(userId);
    const companyName = dto.company_name.trim();
    if (!companyName)
      throw new ProblemException("VALIDATION_FAILED", 400, "Tên công ty không được rỗng");
    return this.idempotency.run(
      `organizer.apply:${userId}`,
      key,
      { companyName, taxCode: dto.tax_code ?? null },
      async (tx) =>
        applicationResponse(
          await tx.organizer.create({
            data: { ownerUserId: userId, companyName, taxCode: dto.tax_code },
          }),
        ),
    );
  }
  async get(userId: string, id: string) {
    const me = await this.access.me(userId);
    const row = await this.repository.get(id);
    if (row.ownerUserId !== userId && !me.roles.includes("ADMIN"))
      throw new ProblemException("FORBIDDEN", 403, "Không có quyền với hồ sơ");
    return {
      ...applicationResponse(row),
      documents: row.documents.map((d) => ({
        id: d.id,
        doc_type: d.docType,
        created_at: d.createdAt.toISOString(),
      })),
    };
  }
  async upload(
    userId: string,
    id: string,
    docType: string,
    file: LicenseFile | undefined,
    key?: string,
  ) {
    await this.access.me(userId);
    const extension = licenseExtension(file);
    const safeFile = file!;
    const fingerprint = {
      docType,
      digest: createHash("sha256").update(safeFile.buffer).digest("hex"),
    };
    return this.idempotency.run(
      `organizer.upload:${userId}:${id}`,
      key,
      fingerprint,
      async (tx) => {
        await this.repository.lockOwned(tx, id, userId);
        const objectKey = `organizers/${id}/${key}.${extension}`;
        await this.storage.put(objectKey, safeFile);
        const row = await tx.organizerDocument.create({
          data: { organizerId: id, docType, objectKey },
        });
        return { id: row.id, doc_type: row.docType, created_at: row.createdAt.toISOString() };
      },
    );
  }
  async download(userId: string, id: string, documentId: string) {
    await this.get(userId, id);
    const row = await this.repository.get(id);
    const document = row.documents.find((d) => d.id === documentId);
    if (!document)
      throw new ProblemException("DOCUMENT_NOT_FOUND", 404, "Không tìm thấy giấy phép");
    return { url: await this.storage.download(document.objectKey), expires_in: 60 };
  }
  private async admin(userId: string) {
    if (!(await this.access.me(userId)).roles.includes("ADMIN"))
      throw new ProblemException("FORBIDDEN", 403, "Cần quyền Admin");
  }
  async list(userId: string, query: OrganizerListDto) {
    await this.admin(userId);
    return this.repository.list(query);
  }
  async decide(userId: string, id: string, dto: OrganizerDecisionDto) {
    await this.admin(userId);
    return this.repository.decide(id, userId, dto);
  }
}
