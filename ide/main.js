// YANG IDE — mustaqil ish stoli muharriri (Electron main jarayoni).
//
// Butun mantiq `ide/ide_host.js` da: oyna, IPC, fayl tizimi, terminal va AI qatlami.
// Shu sabab YANG AI ham xuddi shu yadroni ishlatib, IDE ni ichidan ochadi (bitta
// manba, ikki rejim) — kod ikki nusxada ajralib ketmaydi.
//
// Bu fayl faqat MUSTAQIL dastur uchun hayot aylanishini boshqaradi:
//   • oynani ochish, bir nusxada ishlash;
//   • mintaqaviy menyuni olib tashlash (IDE o'z panelini chizadi);
//   • chiqishda kuzatuvchi/terminal/AI ni to'xtatish.
import { app, BrowserWindow, Menu } from 'electron';
import { registerIdeIpc, openIdeWindow, disposeIde, warmLocalModel } from './ide_host.js';

// Barcha IDE IPC kanallarini (`yide:*`) ro'yxatga olamiz — oyna ochilishidan oldin.
registerIdeIpc({ standalone: true });

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await openIdeWindow();
  // Lokal modelni fonda ko'taramiz — foydalanuvchi AI'ni bosganda tayyor bo'lsin.
  warmLocalModel();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) openIdeWindow(); });
});

app.on('window-all-closed', () => {
  disposeIde();
  if (process.platform !== 'darwin') app.quit();
});
