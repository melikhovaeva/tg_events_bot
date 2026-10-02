const required = ['BOT_TOKEN', 'BOT_USERNAME', 'ADMIN_PASSWORD'];

export function validateConfig() {
  const missing = required.filter((key) => {
    const value = process.env[key] || '';
    return !value || /replace_with|your_bot|change-this/.test(value);
  });
  if (!missing.length) return;
  console.error(`Не заполнены настройки в .env: ${missing.join(', ')}.`);
  console.error('Скопируйте .env.example в .env и укажите значения.');
  process.exit(1);
}

export const policyUrl = 'https://perasperadastra.ru/policy';
export const agreementUrl = 'https://perasperadastra.ru/agreement';
