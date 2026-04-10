import cron from 'node-cron';
import CapitalService from '../services/portfolio/capitalService.js';

/**
 * Settlement Worker
 * Chay moi ngay luc 9:00 AM Mon-Fri (truoc gio giao dich HOSE/HNX 9:15 AM)
 * Xu ly cac settlement_events den han T+2: chuyen tien tu pending sang available
 */
export function startSettlementWorker() {
  // Chay moi ngay luc 9:00 AM (truoc gio giao dich VN: Mon-Fri)
  cron.schedule('0 9 * * 1-5', async () => {
    console.log(`[${new Date().toISOString()}] Settlement worker: processing pending settlements...`);
    try {
      const processed = await CapitalService.processSettlements();
      if (processed > 0) {
        console.log(`[${new Date().toISOString()}] Settlement worker: processed ${processed} settlements`);
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Settlement worker error:`, error.message);
    }
  });
  console.log('[Settlement Worker] Scheduled: daily at 9:00 AM (Mon-Fri)');
}
