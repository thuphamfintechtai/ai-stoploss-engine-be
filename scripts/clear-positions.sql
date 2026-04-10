-- Xóa toàn bộ dữ liệu bảng positions để test lại (logic VND).
-- Chạy: psql -U <user> -d <database> -f scripts/clear-positions.sql
-- Hoặc qua GUI/client: chạy nội dung file này.

BEGIN;

-- Bảng trade_orders tham chiếu positions → xóa trước
DELETE FROM financial.trade_orders;

-- Xóa toàn bộ positions
DELETE FROM financial.positions;

COMMIT;

-- Kiểm tra
-- SELECT COUNT(*) FROM financial.positions;
-- SELECT COUNT(*) FROM financial.trade_orders;
