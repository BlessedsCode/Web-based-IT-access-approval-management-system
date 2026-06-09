// Заполнение демонстрационными данными для проверки и скриншотов. Не часть приложения.
const db = require('./db');

db.exec('DELETE FROM history; DELETE FROM approval_steps; DELETE FROM comments; DELETE FROM files; DELETE FROM requests;');
db.exec("DELETE FROM sqlite_sequence WHERE name IN ('requests','approval_steps','comments','files','history');");

const USER = 3;      // user
const APPROVER = 2;  // approver

const ins = db.prepare(`
  INSERT INTO requests (number, applicant_id, department, resource, access_type, justification, priority, valid_until, status)
  VALUES (?,?,?,?,?,?,?,?,?)
`);
const hist = db.prepare(`
  INSERT INTO history (request_id, changed_by, old_status, new_status, comment)
  VALUES (?,?,?,?,?)
`);

const rows = [
  ['REQ-2026-0001', 'Бухгалтерия', '1С:Бухгалтерия', 'чтение_запись', 'Подготовка квартального отчёта', 'urgent', '2025-01-15', 'на_согласовании'],
  ['REQ-2026-0002', 'Отдел продаж', 'CRM Битрикс24', 'чтение', 'Работа с клиентской базой', 'high', '2026-12-31', 'на_согласовании'],
  ['REQ-2026-0003', 'ИТ-отдел', 'AD-группа Servers-Admin', 'администрирование', 'Сопровождение серверов', 'normal', '2026-09-30', 'на_согласовании'],
  ['REQ-2026-0004', 'Склад', 'WMS Логистика', 'чтение_запись', 'Учёт складских операций', 'normal', '2026-10-01', 'новая'],
  ['REQ-2026-0005', 'Кадры', 'Портал HR', 'чтение', 'Просмотр штатного расписания', 'low', '2026-12-31', 'согласована'],
  ['REQ-2026-0006', 'Финансы', 'Банк-клиент', 'администрирование', 'Доступ запрошен без обоснования', 'high', '2026-08-01', 'отклонена']
];

const tx = db.transaction(() => {
  for (const r of rows) {
    const info = ins.run(r[0], USER, r[1], r[2], r[3], r[4], r[5], r[6], r[7]);
    const id = info.lastInsertRowid;
    hist.run(id, USER, null, 'новая', 'Заявка создана');
    if (r[7] !== 'новая') hist.run(id, USER, 'новая', 'на_согласовании', 'Отправлена на согласование');
    if (r[7] === 'согласована') hist.run(id, APPROVER, 'на_согласовании', 'согласована', 'Согласовано');
    if (r[7] === 'отклонена') hist.run(id, APPROVER, 'на_согласовании', 'отклонена', 'Не указано обоснование');
  }
});
tx();

console.log('Демо-данные загружены:', db.prepare('SELECT status, COUNT(*) c FROM requests GROUP BY status').all());
