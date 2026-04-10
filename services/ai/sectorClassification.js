/**
 * Sector Classification — Map VN stocks sang sector.
 *
 * Per D-19. Phan loai co phieu VN pho bien theo nganh.
 */

/**
 * Map ma co phieu -> sector.
 * @type {Record<string, string>}
 */
export const VN_SECTOR_MAP = {
  // Banking (Ngan hang)
  VCB: 'BANKING',
  BID: 'BANKING',
  CTG: 'BANKING',
  TCB: 'BANKING',
  MBB: 'BANKING',
  ACB: 'BANKING',
  VPB: 'BANKING',
  STB: 'BANKING',
  HDB: 'BANKING',
  TPB: 'BANKING',
  LPB: 'BANKING',
  OCB: 'BANKING',
  MSB: 'BANKING',
  VIB: 'BANKING',
  EIB: 'BANKING',
  SHB: 'BANKING',
  NAB: 'BANKING',
  BVB: 'BANKING',

  // Real Estate (Bat dong san)
  VHM: 'REAL_ESTATE',
  VIC: 'REAL_ESTATE',
  NVL: 'REAL_ESTATE',
  KDH: 'REAL_ESTATE',
  DIG: 'REAL_ESTATE',
  PDR: 'REAL_ESTATE',
  NLG: 'REAL_ESTATE',
  DXG: 'REAL_ESTATE',
  VRE: 'REAL_ESTATE',
  KBC: 'REAL_ESTATE',
  IDC: 'REAL_ESTATE',
  SZC: 'REAL_ESTATE',

  // Technology (Cong nghe)
  FPT: 'TECHNOLOGY',
  CMG: 'TECHNOLOGY',
  ELC: 'TECHNOLOGY',
  VGI: 'TECHNOLOGY',
  ITD: 'TECHNOLOGY',

  // Retail (Ban le)
  MWG: 'RETAIL',
  PNJ: 'RETAIL',
  DGW: 'RETAIL',
  FRT: 'RETAIL',
  VGC: 'RETAIL',

  // Steel (Thep)
  HPG: 'STEEL',
  HSG: 'STEEL',
  NKG: 'STEEL',
  TLH: 'STEEL',
  VGS: 'STEEL',
  SMC: 'STEEL',

  // Securities (Chung khoan)
  SSI: 'SECURITIES',
  VCI: 'SECURITIES',
  HCM: 'SECURITIES',
  SHS: 'SECURITIES',
  VDS: 'SECURITIES',
  CTS: 'SECURITIES',
  BSI: 'SECURITIES',
  MBS: 'SECURITIES',

  // Energy (Nang luong)
  GAS: 'ENERGY',
  POW: 'ENERGY',
  PLX: 'ENERGY',
  PVD: 'ENERGY',
  PVS: 'ENERGY',
  BSR: 'ENERGY',
  OIL: 'ENERGY',
  PGS: 'ENERGY',

  // Consumer (Tieu dung)
  VNM: 'CONSUMER',
  SAB: 'CONSUMER',
  MSN: 'CONSUMER',
  QNS: 'CONSUMER',
  KDC: 'CONSUMER',
  MCH: 'CONSUMER',
  ANV: 'CONSUMER',
  VHC: 'CONSUMER',
};

/**
 * Nhan (label) tieng Viet cho moi sector.
 * @type {Record<string, string>}
 */
export const SECTOR_LABELS = {
  BANKING: 'Ngân hàng',
  REAL_ESTATE: 'Bất động sản',
  TECHNOLOGY: 'Công nghệ',
  RETAIL: 'Bán lẻ',
  STEEL: 'Thép',
  SECURITIES: 'Chứng khoán',
  ENERGY: 'Năng lượng',
  CONSUMER: 'Tiêu dùng',
  OTHER: 'Khác',
};

/**
 * Tra ve sector cua mot co phieu.
 * @param {string} symbol - Ma co phieu
 * @returns {string} sector string, default 'OTHER' neu khong tim thay
 */
export function getSector(symbol) {
  return VN_SECTOR_MAP[symbol?.toUpperCase()] ?? 'OTHER';
}
