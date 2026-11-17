import "dotenv/config";
import { loadEnv } from "@ticketing/common";
import type { Pool } from "pg";
import { envSchema } from "../config/env.schema";
import { OfflineKeys } from "../modules/offline/offline-keys";
import { TicketRepository } from "../modules/tickets/ticket.repository";
import { TicketSecrets } from "../modules/tickets/ticket-secrets";

interface SecretRow {
  id: string;
  context_id: string;
  version: number;
  key_id: string;
  secret_enc: Buffer;
}

export async function rotateTicketKeys(
  pool: Pool,
  keys: Record<string, string>,
  activeKeyId: string,
  apply: boolean,
) {
  if (!Object.hasOwn(keys, activeKeyId)) throw new Error("TICKET_KEY_UNAVAILABLE");
  const sources = [
    {
      cipher: new TicketSecrets(keys, activeKeyId),
      select: `SELECT id,ticket_id AS context_id,version,key_id,secret_enc FROM ticket_secrets
        WHERE ($1::uuid IS NULL OR id>$1::uuid) AND key_id<>$2 ORDER BY id LIMIT 100`,
      update: `UPDATE ticket_secrets SET key_id=$3,secret_enc=$4
        WHERE id=$1::uuid AND key_id=$2 AND secret_enc=$5`,
    },
    {
      cipher: new OfflineKeys({
        TICKET_ENCRYPTION_KEYS: keys,
        TICKET_ACTIVE_KEY_ID: activeKeyId,
      }),
      select: `SELECT id,id AS context_id,1 AS version,key_id,secret_enc FROM offline_devices
        WHERE ($1::uuid IS NULL OR id>$1::uuid) AND key_id<>$2 ORDER BY id LIMIT 100`,
      update: `UPDATE offline_devices SET key_id=$3,secret_enc=$4
        WHERE id=$1::uuid AND key_id=$2 AND secret_enc=$5`,
    },
  ];
  const result = { checked: 0, rotated: 0, conflicts: 0 };
  for (const source of sources) {
    let cursor: string | null = null;
    for (;;) {
      const rows: SecretRow[] = (await pool.query<SecretRow>(source.select, [cursor, activeKeyId]))
        .rows;
      if (!rows.length) break;

      for (const row of rows) {
        const plaintext = source.cipher.decrypt(row.context_id, row.version, {
          keyId: row.key_id,
          ciphertext: row.secret_enc,
        });
        try {
          result.checked++;
          if (!apply) continue;
          const { keyId, ciphertext } = source.cipher.encrypt(
            row.context_id,
            row.version,
            plaintext,
          );
          const { rowCount } = await pool.query(source.update, [
            row.id,
            row.key_id,
            keyId,
            ciphertext,
            row.secret_enc,
          ]);
          result.rotated += rowCount ?? 0;
          if (!rowCount) result.conflicts++;
        } finally {
          plaintext.fill(0);
        }
      }
      cursor = rows[rows.length - 1].id;
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args[0] === "--apply";
  if (args.length > 1 || (args.length === 1 && !apply)) {
    process.stderr.write("Usage: pnpm keys:rotate [--apply]\n");
    process.exitCode = 1;
    return;
  }
  const env = loadEnv(envSchema);
  if (!env.TICKET_ENCRYPTION_KEYS || !env.TICKET_ACTIVE_KEY_ID) {
    throw new Error("TICKET_KEY_UNAVAILABLE");
  }
  const repo = new TicketRepository(env);
  try {
    const result = await rotateTicketKeys(
      repo.pool,
      env.TICKET_ENCRYPTION_KEYS,
      env.TICKET_ACTIVE_KEY_ID,
      apply,
    );
    process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "check", ...result })}\n`);
    if (result.conflicts) process.exitCode = 1;
  } finally {
    await repo.onApplicationShutdown();
  }
}

if (require.main === module) {
  void main().catch(() => {
    process.stderr.write("Ticket key rotation failed. Check key rings and the Ticket database.\n");
    process.exitCode = 1;
  });
}
