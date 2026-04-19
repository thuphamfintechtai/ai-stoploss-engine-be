/**
 * promptContextEnricher.test.js — AIT-06 (D-06)
 *
 * Test service `enrichSymbolContext` ground Gemini prompt với:
 *   - VN-Index trend 1 ngày (getMarketData('VNINDEX'))
 *   - Sector của mã (getSector + SECTOR_LABELS)
 *   - Tối đa 3 tin cafef gần nhất (getCafefMarketNews)
 *
 * Bắt buộc graceful degrade: bất kỳ source nào fail → prompt vẫn gửi, header
 * ghi "không khả dụng"/"chưa phân loại"/"lỗi lấy tin".
 * Có cache per-symbol 5 phút. Header ≤ 2000 ký tự.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetMarketData = vi.fn();
const mockGetSector = vi.fn();
const mockGetCafefMarketNews = vi.fn();

vi.mock('../../services/shared/marketPriceService.js', () => ({
  getMarketData: (...args) => mockGetMarketData(...args),
}));

vi.mock('../../services/ai/sectorClassification.js', () => ({
  getSector: (...args) => mockGetSector(...args),
  SECTOR_LABELS: {
    BANKING: 'Ngân hàng',
    REAL_ESTATE: 'Bất động sản',
    CONSUMER: 'Tiêu dùng',
    OTHER: 'Khác',
  },
}));

vi.mock('../../services/cafefNewsService.js', () => ({
  getCafefMarketNews: (...args) => mockGetCafefMarketNews(...args),
}));

const { enrichSymbolContext, buildContextHeader, __contextCache } = await import(
  '../../services/ai/promptContextEnricher.js'
);

describe('enrichSymbolContext — AIT-06 (D-06)', () => {
  beforeEach(() => {
    __contextCache.clear();
    mockGetMarketData.mockReset();
    mockGetSector.mockReset();
    mockGetCafefMarketNews.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Test 1.1 — happy path: cả 3 source ok → header đầy đủ', async () => {
    mockGetMarketData.mockResolvedValue({ price: 1234.56, reference: 1219.56, high: 1240, low: 1210, quantity: 100 });
    mockGetSector.mockReturnValue('BANKING');
    mockGetCafefMarketNews.mockResolvedValue({
      source: 'CafeF',
      url: 'https://cafef.vn',
      total: 3,
      articles: [
        { title: 'VCB báo lãi quý 1 tăng 15%', url: 'x1', date: '', description: '' },
        { title: 'Ngân hàng dẫn dắt đà tăng VN-Index', url: 'x2', date: '', description: '' },
        { title: 'Khối ngoại mua ròng VCB', url: 'x3', date: '', description: '' },
      ],
      timestamp: '',
    });

    const ctx = await enrichSymbolContext('VCB', 'HOSE');

    expect(ctx.vnindex.status).toBe('ok');
    expect(ctx.vnindex.change_pct).toBeCloseTo(1.23, 1);
    expect(ctx.sector.status).toBe('ok');
    expect(ctx.sector.key).toBe('BANKING');
    expect(ctx.sector.label).toBe('Ngân hàng');
    expect(ctx.news.status).toBe('ok');
    expect(ctx.news.articles.length).toBe(3);

    expect(ctx.header).toContain('Bối cảnh thị trường');
    expect(ctx.header).toContain('VN-Index');
    expect(ctx.header).toMatch(/\+1\.23%|\+1,23%/);
    expect(ctx.header).toContain('Ngân hàng');
    expect(ctx.header).toContain('Tin cafef gần đây');
    expect(ctx.header).toContain('VCB báo lãi quý 1 tăng 15%');
  });

  it('Test 1.2 — VN-Index fail → degrade text, sector + news vẫn ok', async () => {
    mockGetMarketData.mockRejectedValue(new Error('VPBS down'));
    mockGetSector.mockReturnValue('BANKING');
    mockGetCafefMarketNews.mockResolvedValue({
      articles: [{ title: 'Headline A', url: 'x', date: '', description: '' }],
    });

    const ctx = await enrichSymbolContext('VCB', 'HOSE');

    expect(ctx.vnindex.status).toBe('unavailable');
    expect(ctx.vnindex.change_pct).toBeNull();
    expect(ctx.header).toContain('VN-Index: không khả dụng');
    expect(ctx.sector.status).toBe('ok');
    expect(ctx.news.status).toBe('ok');
  });

  it('Test 1.3 — sector unknown (OTHER / null) → header ghi "chưa phân loại"', async () => {
    mockGetMarketData.mockResolvedValue({ price: 1200, reference: 1200 });
    mockGetSector.mockReturnValue('OTHER');
    mockGetCafefMarketNews.mockResolvedValue({ articles: [] });

    const ctx = await enrichSymbolContext('XYZ', 'HOSE');

    expect(ctx.sector.status).toBe('unknown');
    expect(ctx.header).toContain('Ngành: chưa phân loại');
  });

  it('Test 1.4 — news empty → header "không có tin gần đây"', async () => {
    mockGetMarketData.mockResolvedValue({ price: 1200, reference: 1200 });
    mockGetSector.mockReturnValue('CONSUMER');
    mockGetCafefMarketNews.mockResolvedValue({ articles: [] });

    const ctx = await enrichSymbolContext('VNM', 'HOSE');

    expect(ctx.news.status).toBe('empty');
    expect(ctx.news.articles.length).toBe(0);
    expect(ctx.header).toContain('Tin tức: không có tin gần đây cho VNM');
  });

  it('Test 1.5 — news reject → header "lỗi lấy tin"', async () => {
    mockGetMarketData.mockResolvedValue({ price: 1200, reference: 1200 });
    mockGetSector.mockReturnValue('CONSUMER');
    mockGetCafefMarketNews.mockRejectedValue(new Error('cafef 503'));

    const ctx = await enrichSymbolContext('VNM', 'HOSE');

    expect(ctx.news.status).toBe('error');
    expect(ctx.header).toContain('Tin tức: lỗi lấy tin');
  });

  it('Test 1.6 — cả 3 fail → header có 3 dòng degrade, function không throw', async () => {
    mockGetMarketData.mockRejectedValue(new Error('VPBS down'));
    mockGetSector.mockImplementation(() => {
      throw new Error('sector corrupt');
    });
    mockGetCafefMarketNews.mockRejectedValue(new Error('cafef down'));

    const ctx = await enrichSymbolContext('ABC', 'HOSE');

    expect(ctx.vnindex.status).toBe('unavailable');
    expect(ctx.sector.status).toBe('unknown');
    expect(ctx.news.status).toBe('error');
    expect(ctx.header).toContain('VN-Index: không khả dụng');
    expect(ctx.header).toContain('Ngành: chưa phân loại');
    expect(ctx.header).toContain('Tin tức: lỗi lấy tin');
  });

  it('Test 1.7 — cache hit: lần 2 không gọi lại mocks', async () => {
    mockGetMarketData.mockResolvedValue({ price: 1200, reference: 1190 });
    mockGetSector.mockReturnValue('BANKING');
    mockGetCafefMarketNews.mockResolvedValue({
      articles: [{ title: 'N1', url: '', date: '', description: '' }],
    });

    await enrichSymbolContext('VCB', 'HOSE');
    expect(mockGetMarketData).toHaveBeenCalledTimes(1);
    expect(mockGetSector).toHaveBeenCalledTimes(1);
    expect(mockGetCafefMarketNews).toHaveBeenCalledTimes(1);

    // Cache hit: không gọi thêm
    await enrichSymbolContext('VCB', 'HOSE');
    expect(mockGetMarketData).toHaveBeenCalledTimes(1);
    expect(mockGetSector).toHaveBeenCalledTimes(1);
    expect(mockGetCafefMarketNews).toHaveBeenCalledTimes(1);
  });

  it('Test 1.8 — cache expire sau 5+ phút → fetch lại', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-19T10:00:00Z'));

    mockGetMarketData.mockResolvedValue({ price: 1200, reference: 1190 });
    mockGetSector.mockReturnValue('BANKING');
    mockGetCafefMarketNews.mockResolvedValue({
      articles: [{ title: 'N1', url: '', date: '', description: '' }],
    });

    await enrichSymbolContext('VCB', 'HOSE');
    expect(mockGetMarketData).toHaveBeenCalledTimes(1);

    // Advance 6 phút → cache expired
    vi.setSystemTime(new Date('2026-04-19T10:06:00Z'));

    await enrichSymbolContext('VCB', 'HOSE');
    expect(mockGetMarketData).toHaveBeenCalledTimes(2);
  });

  it('Test 1.9 — header length cap ≤ 2000 ký tự (truncate titles)', async () => {
    mockGetMarketData.mockResolvedValue({ price: 1200, reference: 1190 });
    mockGetSector.mockReturnValue('BANKING');
    const longTitle = 'T'.repeat(5000);
    mockGetCafefMarketNews.mockResolvedValue({
      articles: [
        { title: longTitle, url: 'a', date: '', description: '' },
        { title: longTitle, url: 'b', date: '', description: '' },
        { title: longTitle, url: 'c', date: '', description: '' },
      ],
    });

    const ctx = await enrichSymbolContext('VCB', 'HOSE');
    expect(ctx.header.length).toBeLessThanOrEqual(2000);
  });

  it('buildContextHeader(result) → trả header string', async () => {
    mockGetMarketData.mockResolvedValue({ price: 1200, reference: 1190 });
    mockGetSector.mockReturnValue('BANKING');
    mockGetCafefMarketNews.mockResolvedValue({ articles: [] });

    const ctx = await enrichSymbolContext('VCB', 'HOSE');
    expect(buildContextHeader(ctx)).toBe(ctx.header);
    expect(buildContextHeader(null)).toBe('');
    expect(buildContextHeader(undefined)).toBe('');
  });
});
