-- Chỉ dùng để rollback S-101 trong DB kiểm thử mới tạo; không chạy trên dữ liệu thật.
BEGIN;
DROP TABLE processed_events, outbox_events, organizer_documents, user_roles,
  oauth_accounts, refresh_tokens, kyc_profiles, organizers, roles, users;
COMMIT;
