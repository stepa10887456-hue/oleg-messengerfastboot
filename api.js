const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// JWT Secret (в продакшене используйте environment variables)
const JWT_SECRET = process.env.JWT_SECRET || 'oleg-messenger-secret-key';

// In-memory хранилище (в продакшене используйте базу данных)
let users = [];
let contacts = [];
let messages = {};
let onlineUsers = new Map();

// Middleware для проверки JWT токена
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Токен доступа отсутствует' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Неверный токен' });
    }
    req.user = user;
    next();
  });
};

// Routes

// Регистрация
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Валидация
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
    }

    // Проверка существующего пользователя
    const existingUser = users.find(user => user.email === email);
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }

    // Хеширование пароля
    const hashedPassword = await bcrypt.hash(password, 10);

    // Создание пользователя
    const user = {
      id: uuidv4(),
      name,
      email,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    users.push(user);

    // Создание контакта Oleg для нового пользователя
    const olegContact = {
      id: uuidv4(),
      userId: user.id,
      contactId: 'oleg-system',
      name: 'Oleg',
      email: 'support@oleg-messenger.com',
      lastMessage: 'Спасибо что выбрали нас! Oleg - очень безопасный мессенджер',
      time: new Date().toISOString(),
      unread: 1,
      online: true,
      isOleg: true
    };

    contacts.push(olegContact);

    // Создание приветственного сообщения
    const welcomeMessage = {
      id: uuidv4(),
      chatId: olegContact.id,
      text: 'Спасибо что выбрали нас! Oleg - очень безопасный мессенджер. Здесь ваши сообщения защищены современными методами шифрования.',
      time: new Date().toISOString(),
      sender: 'contact',
      type: 'text'
    };

    if (!messages[user.id]) {
      messages[user.id] = {};
    }
    messages[user.id][olegContact.id] = [welcomeMessage];

    // Генерация JWT токена
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'Пользователь успешно зарегистрирован',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Вход
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Валидация
    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    // Поиск пользователя
    const user = users.find(user => user.email === email);
    if (!user) {
      return res.status(400).json({ error: 'Неверный email или пароль' });
    }

    // Проверка пароля
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Неверный email или пароль' });
    }

    // Генерация JWT токена
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Добавление в онлайн пользователей
    onlineUsers.set(user.id, {
      id: user.id,
      name: user.name,
      email: user.email,
      lastSeen: new Date().toISOString()
    });

    res.json({
      message: 'Вход выполнен успешно',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Получение контактов пользователя
app.get('/api/contacts', authenticateToken, (req, res) => {
  try {
    const userContacts = contacts.filter(contact => contact.userId === req.user.userId);
    res.json(userContacts);
  } catch (error) {
    console.error('Ошибка получения контактов:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Получение сообщений чата
app.get('/api/messages/:chatId', authenticateToken, (req, res) => {
  try {
    const { chatId } = req.params;
    const userMessages = messages[req.user.userId] || {};
    const chatMessages = userMessages[chatId] || [];
    res.json(chatMessages);
  } catch (error) {
    console.error('Ошибка получения сообщений:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Отправка сообщения
app.post('/api/messages', authenticateToken, (req, res) => {
  try {
    const { chatId, text, type = 'text', file } = req.body;

    if (!chatId || (!text && !file)) {
      return res.status(400).json({ error: 'chatId и text/file обязательны' });
    }

    const message = {
      id: uuidv4(),
      chatId,
      text,
      type,
      file,
      time: new Date().toISOString(),
      sender: 'user'
    };

    // Инициализация хранилища сообщений пользователя
    if (!messages[req.user.userId]) {
      messages[req.user.userId] = {};
    }
    if (!messages[req.user.userId][chatId]) {
      messages[req.user.userId][chatId] = [];
    }

    messages[req.user.userId][chatId].push(message);

    // Обновление последнего сообщения в контакте
    const contact = contacts.find(c => c.id === chatId && c.userId === req.user.userId);
    if (contact) {
      contact.lastMessage = text || (file ? `Файл: ${file.name}` : 'Вложение');
      contact.time = new Date().toISOString();
    }

    // Имитация ответа для обычных контактов
    if (contact && !contact.isOleg) {
      setTimeout(() => {
        simulateReply(req.user.userId, chatId);
      }, 1000 + Math.random() * 2000);
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Получение онлайн пользователей
app.get('/api/online-users', authenticateToken, (req, res) => {
  try {
    const onlineUsersList = Array.from(onlineUsers.values())
      .filter(user => user.id !== req.user.userId);
    res.json(onlineUsersList);
  } catch (error) {
    console.error('Ошибка получения онлайн пользователей:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Добавление контакта
app.post('/api/contacts', authenticateToken, (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email обязателен' });
    }

    // Поиск пользователя
    const userToAdd = users.find(user => user.email === email && user.id !== req.user.userId);
    if (!userToAdd) {
      return res.status(404).json({ error: 'Пользователь с таким email не найден' });
    }

    // Проверка существующего контакта
    const existingContact = contacts.find(
      contact => contact.userId === req.user.userId && contact.email === email
    );
    if (existingContact) {
      return res.status(400).json({ error: 'Этот пользователь уже есть в ваших контактах' });
    }

    // Создание контакта
    const contact = {
      id: uuidv4(),
      userId: req.user.userId,
      contactId: userToAdd.id,
      name: userToAdd.name,
      email: userToAdd.email,
      lastMessage: 'Начните общение',
      time: new Date().toISOString(),
      unread: 0,
      online: onlineUsers.has(userToAdd.id),
      isOleg: false
    };

    contacts.push(contact);
    res.status(201).json(contact);
  } catch (error) {
    console.error('Ошибка добавления контакта:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Удаление сообщения
app.delete('/api/messages/:chatId/:messageId', authenticateToken, (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    
    const userMessages = messages[req.user.userId];
    if (userMessages && userMessages[chatId]) {
      messages[req.user.userId][chatId] = userMessages[chatId].filter(
        msg => msg.id !== messageId
      );
    }
    
    res.json({ message: 'Сообщение удалено' });
  } catch (error) {
    console.error('Ошибка удаления сообщения:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Функция имитации ответа
function simulateReply(userId, chatId) {
  const replies = [
    "Интересно!",
    "Понятно",
    "Согласен",
    "Расскажи подробнее",
    "Хорошо, договорились"
  ];
  
  const randomReply = replies[Math.floor(Math.random() * replies.length)];
  
  const replyMessage = {
    id: uuidv4(),
    chatId,
    text: randomReply,
    time: new Date().toISOString(),
    sender: 'contact',
    type: 'text'
  };

  if (!messages[userId]) {
    messages[userId] = {};
  }
  if (!messages[userId][chatId]) {
    messages[userId][chatId] = [];
  }

  messages[userId][chatId].push(replyMessage);

  // Обновление контакта
  const contact = contacts.find(c => c.id === chatId && c.userId === userId);
  if (contact) {
    contact.lastMessage = randomReply;
    contact.time = new Date().toISOString();
    contact.unread = (contact.unread || 0) + 1;
  }
}

// Обработка несуществующих маршрутов
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});

// Экспорт для Netlify Functions
module.exports.handler = serverless(app);