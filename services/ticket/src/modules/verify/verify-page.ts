import { PublicTicketDto } from "./verify.dto";

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

export function verifyPage(ticket?: PublicTicketDto, error?: string): string {
  const states: Record<string, string> = {
    ACTIVE: "Vé đang hoạt động",
    FROZEN: "Vé đang tạm khóa",
    CHECKED_IN: "Vé đã check-in",
    REVOKED: "Vé đã bị thu hồi",
    REFUNDED: "Vé đã hoàn tiền",
  };
  const mintStates: Record<string, string> = {
    NOT_REQUESTED: "Chưa yêu cầu mint",
    PENDING: "Đang chờ xử lý",
    MINTING: "Đang xử lý",
    MINTED: "Đã mint",
    FAILED: "Mint thất bại",
  };
  const result = ticket
    ? `<section aria-labelledby="result"><p class="eyebrow">KẾT QUẢ TRA CỨU</p><h2 id="result">${escape(states[ticket.status] ?? ticket.status)}</h2>
    <dl><dt>Mã vé</dt><dd class="code">${escape(ticket.ticket_id)}</dd><dt>NFT</dt><dd>${escape(mintStates[ticket.nft.status] ?? ticket.nft.status)}</dd><dt>Mạng</dt><dd>${ticket.nft.provider === "MOCK" ? "Mô phỏng local · chưa mint on-chain" : "Chưa có dữ liệu on-chain"}</dd><dt>Transaction hash</dt><dd>${ticket.nft.tx_hash ? escape(ticket.nft.tx_hash) : "Chưa có giao dịch on-chain"}</dd></dl></section>`
    : "";
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Tra cứu vé · VENTIX</title>
  <style>*,*::before,*::after{box-sizing:border-box}body{margin:0;background:#f4f5f8;color:#172033;font:16px/1.6 system-ui,sans-serif}header{padding:24px max(24px,calc((100vw - 840px)/2));background:#172033;color:white;font-weight:800;letter-spacing:.16em}main{max-width:840px;margin:56px auto;padding:0 24px}h1{font-size:clamp(30px,5vw,44px);line-height:1.15;margin:8px 0 20px}h2{margin:8px 0 24px;font-size:24px}.eyebrow{font-size:12px;letter-spacing:.12em;font-weight:700;color:#536078}form,section{background:white;border:1px solid #dce0e8;border-radius:16px;padding:28px;margin:28px 0}label{display:block;font-weight:650;margin-bottom:10px}input{width:100%;padding:14px;border:1px solid #748096;border-radius:8px;font:inherit}button{margin-top:16px;padding:13px 24px;background:#214de0;color:white;border:0;border-radius:8px;font:inherit;font-weight:650;cursor:pointer}input:focus-visible,button:focus-visible{outline:3px solid #778fff;outline-offset:3px}.hint{color:#536078;font-size:14px}dl{display:grid;grid-template-columns:160px minmax(0,1fr);gap:12px 24px}dt{color:#536078}dd{margin:0}.code{font-family:monospace;overflow-wrap:anywhere}.error{color:#a72020}footer{border-top:1px solid #dce0e8;padding:20px 0;font-size:14px;color:#536078}@media(max-width:540px){main{margin-top:32px}form,section{padding:20px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:14px}button{width:100%}}</style></head>
  <body><header>VENTIX</header><main><p class="eyebrow">TRA CỨU CÔNG KHAI</p><h1>Kiểm tra trạng thái vé</h1><p>Nhập mã vé để xem trạng thái hiện tại và thông tin mint NFT.</p>
  <form method="get" action="/v1/verify"><label for="ticket_id">Mã vé</label><input id="ticket_id" name="ticket_id" type="text" maxlength="36" required autocomplete="off" spellcheck="false" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="${ticket ? escape(ticket.ticket_id) : ""}" aria-describedby="ticket-hint"><p id="ticket-hint" class="hint">Mã UUID của vé. Không nhập mã TOTP hoặc thông tin cá nhân.</p><button type="submit">Tra cứu vé</button></form>
  ${error ? `<p role="alert" class="error">${escape(error)}</p>` : ""}${result}<footer>Tra cứu không xác minh người sở hữu và không thay thế quy trình check-in. Trạng thái NFT không quyết định hiệu lực của vé.</footer></main></body></html>`;
}
