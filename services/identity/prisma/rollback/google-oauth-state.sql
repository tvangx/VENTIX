-- Rollback S-103 trước các migration cũ hơn; chỉ dùng trên DB kiểm thử đã xác nhận.
DROP TABLE google_oauth_states;
