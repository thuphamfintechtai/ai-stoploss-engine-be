/**
 * Script gọi trực tiếp API VPBS stockDetailByIndex, in ra số bản ghi và mẫu dữ liệu.
 * Chạy: node scripts/fetch-stock-detail-by-index.js [indexCode] [pageSize]
 * VD: node scripts/fetch-stock-detail-by-index.js VNXALL 100
 */
const INDEX = process.argv[2] || 'VNXALL';
const PAGE_SIZE = Math.min(5000, Math.max(1, parseInt(process.argv[3], 10) || 500));
const URL = `https://neopro.vpbanks.com.vn/neo-inv-tools/noauth/public/v1/stock/stockDetailByIndex?indexCode=${encodeURIComponent(INDEX)}&pageNo=1&pageSize=${PAGE_SIZE}`;

async function main() {
  console.log('Fetching:', URL);
  const res = await fetch(URL);
  const json = await res.json();
  console.log('Top-level keys:', Object.keys(json));
  if (json.data !== undefined) {
    console.log('json.data type:', Array.isArray(json.data) ? 'array' : typeof json.data);
    if (json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
      console.log('json.data keys:', Object.keys(json.data));
    }
  }
  const list = Array.isArray(json.data) ? json.data : (json.data?.content ?? json.data?.list ?? json.data?.data ?? json.data?.stockList ?? []);
  console.log('Status:', json.status ?? json.code);
  console.log('Count:', list.length);
  if (list.length > 0) {
    const first = list[0];
    console.log('Sample fields:', Object.keys(first).slice(0, 25).join(', '));
    console.log('First row (symbol, ref, ceiling, floor, close):', first.symbol, first.reference ?? first.referencePrice, first.ceiling ?? first.ceilingPrice, first.floor ?? first.floorPrice, first.closePrice ?? first.matchPrice);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
