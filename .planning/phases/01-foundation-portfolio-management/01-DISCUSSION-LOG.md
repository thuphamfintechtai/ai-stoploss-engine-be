# Phase 1: Foundation & Portfolio Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-26
**Phase:** 01-foundation-portfolio-management
**Areas discussed:** Context Separation, Real Order Entry, Cash Balance, Position Close
**Mode:** Auto (all recommended defaults selected)

---

## Context Separation Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Context column | Thêm `context` column vào bảng hiện tại — migration nhẹ | ✓ |
| Tạo bảng mới | Bảng riêng cho real vs paper — isolation tốt hơn | |

**User's choice:** Context column (auto-selected recommended)
**Notes:** Research ARCHITECTURE.md khuyến nghị context column approach, pragmatic cho brownfield refactor

## Real Order Entry UX

| Option | Description | Selected |
|--------|-------------|----------|
| Form đơn giản | Mã CK, side, số lượng, giá khớp, ngày — không order type | ✓ |
| Form đầy đủ | Bao gồm order type, limit price, matching status | |

**User's choice:** Form đơn giản (auto-selected recommended)
**Notes:** User đã nói rõ muốn "nhập lệnh đã đặt trên sàn" — chỉ ghi nhận

## Cash Balance Model

| Option | Description | Selected |
|--------|-------------|----------|
| Available + Pending | Tách available_cash vs pending_settlement_cash, T+2 | ✓ |
| Đơn giản | Chỉ total_balance, không tính T+2 | |

**User's choice:** Available + Pending (auto-selected recommended)
**Notes:** T+2 settlement là table stakes cho VN stock platform (PITFALLS.md)

## Position Close Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Manual close với giá bán | User nhập giá bán + ngày, hệ thống tính P&L | ✓ |
| Auto close | Tự động đóng khi SL/TP trigger | |

**User's choice:** Manual close (auto-selected recommended)
**Notes:** Portfolio thật không auto-close — user bán trên sàn rồi ghi nhận

## Claude's Discretion

- Directory structure cho controllers mới
- Loading states và error messages
- Migration file numbering

## Deferred Ideas

None
