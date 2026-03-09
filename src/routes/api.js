'use strict';

const { Router } = require('express');
const usersController = require('../controllers/users.controller');

const router = Router();

// CORS for the Chrome extension
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

router.use(require('express').json({ limit: '512kb' }));

router.post('/users/register', usersController.register);
router.get('/users/me', usersController.getMe);

module.exports = router;
