const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from project root (flat frontend structure)
app.use(express.static(path.join(__dirname, '..')));

// Simple test route to verify API is alive
app.get('/ping', (req, res) => res.send('Pong! Saftech API is active.'));

// Routes
app.use('/api', apiRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));