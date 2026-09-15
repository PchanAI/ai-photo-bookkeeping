/**
 * 財政部電子發票整合服務平台 - 載具發票 CSV 自動化下載腳本 (Playwright)
 * 
 * 執行前準備：
 * 1. 安裝 Playwright: npm install playwright
 * 2. 啟動本指令：node scripts/download_invoices.js
 * 
 * 運作說明：
 * 本腳本將自動開啟 Chromium 瀏覽器，並導向財政部平台。
 * 請在開啟的視窗中手動輸入「圖形驗證碼」並登入。
 * 登入成功後，腳本將自動跳轉至查詢頁面，點選下載 CSV 檔。
 */

import { chromium } from 'playwright';
import path from 'path';

async function downloadInvoiceCSV() {
  console.log('正在啟動瀏覽器...');
  const browser = await chromium.launch({ 
    headless: false, // 設為 false 以利手動輸入圖形驗證碼
    slowMo: 100 
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('正在導向財政部電子發票整合服務平台（民眾登入專區）...');
  // 使用登入挑戰 (login_challenge) 入口，避免跳轉/網址變更導致登入頁不同
  await page.goto('https://www.einvoice.nat.gov.tw/accounts/login/mw?login_challenge');


  console.log('💡 請於開啟的瀏覽器中：');
  console.log('1. 輸入您的手機號碼、驗證碼/密碼');
  console.log('2. 輸入畫面中的「圖形驗證碼」');
  console.log('3. 點擊「登入」按鈕。');
  console.log('----------------------------------------------------');
  console.log('正在偵測登入狀態，登入成功跳轉後會自動接續執行下載...');

  // 等待登入成功並導向「載具發票查詢」或民眾主頁 BTC501W 頁面
  try {
    await page.waitForURL('**/BTC501W/**', { timeout: 120000 });
  } catch (err) {
    console.error('等待登入逾時，請確認是否成功登入平台。');
    await browser.close();
    return;
  }

  console.log('🎉 登入成功！正在引導至發票查詢下載頁面...');
  
  // 導向載具發票查詢專區
  await page.goto('https://www.einvoice.nat.gov.tw/APCONSUMER/BTC505W/');
  await page.waitForTimeout(2000);

  // 選取查詢條件 (預設查詢當月發票)
  console.log('正在設定查詢時間段為當月...');
  
  // 點選「查詢」按鈕
  await page.click('input[name="btnQuery"]');
  await page.waitForTimeout(3000);

  console.log('正在準備下載 CSV 發票清單...');

  // 攔截並下載 CSV
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.click('input[name="btnDownloadCsv"]') // 點擊下載 CSV 按鈕
    ]);

    const filename = 'invoice_export_' + Date.now() + '.csv';
    const savePath = path.join(process.cwd(), filename);
    await download.saveAs(savePath);

    console.log('----------------------------------------------------');
    console.log(`✨ 成功！發票 CSV 檔案已下載至：\n👉 ${savePath}`);
    console.log('請回到您的 AI 記帳系統，打開「匯入載具發票」->「匯入 CSV 檔案」，拖放此 CSV 完成記帳！');
  } catch (err) {
    console.error('⚠️ 未能自動偵測到下載按鈕或下載逾時。請手動在瀏覽器中點擊「下載 CSV」，並將下載的檔案導入系統。');
  }

  await page.waitForTimeout(5000);
  await browser.close();
}

downloadInvoiceCSV().catch(err => {
  console.error('腳本執行異常：', err);
});
