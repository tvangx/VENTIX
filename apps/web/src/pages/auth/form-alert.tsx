/** Lỗi chung của form (từ API); role="alert" để trình đọc màn hình đọc ngay. */
export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="m-0 rounded-[14px] bg-field px-4 py-3 text-[15px] font-bold text-destructive"
    >
      {message}
    </p>
  );
}
