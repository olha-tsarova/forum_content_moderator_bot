# forum_content_moderator_bot

Бот фільтрує типи повідомлень у топіках Telegram-форумів.
Працює одразу з багатьма чатами: кожен адмін налаштовує правила сам через команди.

## Налаштування

### 1. Токен
```bash
echo "BOT_TOKEN=your_token_here" > .env
```

### 2. Права бота в чаті

- Додай бота в групу/форум
- Зроби його адміном
- Обов'язково увімкни право **Delete messages**

### 3. Privacy mode

У `@BotFather` вимкни privacy mode (`/setprivacy -> Disable`), інакше бот не бачитиме всі повідомлення в групах.

### 4. Налаштування правил адміном

У потрібному топіку:

- `/setup` — коротка інструкція
- `/allow text photo document` — задати дозволені типи для поточного топіка
- `/types` — показати дозволені типи поточного топіка
- `/topics` — показати всі налаштовані топіки поточного чату
- `/reset_topic` — видалити правило поточного топіка

**Доступні типи:**
`text`, `photo`, `document`, `video`, `audio`, `sticker`, `voice`, `video_note`, `animation`

Правила зберігаються в SQLite: `data/bot.db`

---

## Запуск

### Локально / dev
```bash
npm install
npm run dev
```

### VPS з pm2
```bash
npm install
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # щоб стартував після перезавантаження
```

### Docker
```bash
docker build -t forum_content_moderator_bot .
docker run -d --env-file .env --restart unless-stopped forum_content_moderator_bot
```

### Railway
1. Запушити репо на GitHub
2. New Project → Deploy from GitHub
3. Додати `BOT_TOKEN` в `Variables`
4. Переконатись, що Start Command = `npm start` (або залишити авто-детект)
5. Зробити redeploy

#### Важливо для SQLite на Railway

За замовчуванням файлова система контейнера тимчасова, тому без volume файл `data/bot.db` може скидатися після рестарту.

Щоб зберігати правила між деплоями:

1. Відкрий сервіс у Railway
2. Вкладка `Volumes` → `New Volume`
3. Mount path: `/app/data`
4. Redeploy сервіс

Після цього БД `data/bot.db` буде персистентною.

#### Налагодження на Railway (checklist)

1. `Deployments` → відкрий останній deploy → `Logs`
2. Перевір, що в логах є:
   - `Bot is starting...`
   - `Bot is running`
3. Якщо бот не стартує:
   - перевір `BOT_TOKEN` (без пробілів/лапок)
   - перевір, що бот доданий у чат і має `Delete messages`
   - перевір, що в BotFather вимкнено privacy mode
4. Якщо правила "зникають" після рестарту:
   - перевір, що volume змонтований саме в `/app/data`
   - перевір, що бот реально пише в `data/bot.db`
5. Якщо бот не видаляє контент:
   - перевір адмін-права бота в конкретному чаті
   - в топіку задай правило командою `/allow ...` і перевір `/types`
