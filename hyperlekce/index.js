const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3002;

// TODO: optionally move credentials to env variables
const db = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

app.use(express.json());

// Statické soubory (index.html, CSS, JS)
app.use(express.static(path.join(__dirname)));

// Pomocná funkce: načíst super lessons + sections
app.get('/api/data', async (req, res) => {
  try {
    const result = await db.query(`
        SELECT 
          sl.id AS super_id, sl.title AS super_title, sl.description,
          s.id AS section_id, s.title AS section_title, s.position
        FROM superLessons sl
        LEFT JOIN sections s ON s.super_lesson_id = sl.id
        ORDER BY sl.id ASC, s.position NULLS LAST, s.id ASC
      `);

    const map = new Map();
    result.rows.forEach(row => {
      if (!map.has(row.super_id)) {
        map.set(row.super_id, {
          id: row.super_id,
          title: row.super_title,
          description: row.description,
          sections: [],
        });
      }
      if (row.section_id) {
        map.get(row.super_id).sections.push({
          id: row.section_id,
          title: row.section_title,
          position: row.position,
          exercises: [], // placeholder; actual lessons/exercises live in Investigo
        });
      }
    });

    res.json(Array.from(map.values()));
  } catch (err) {
    console.error('Chyba při načítání dat:', err);
    res.status(500).json({ error: 'Chyba serveru při načítání dat.' });
  }
});

// --- Super Lessons ---
app.post('/api/super-lessons', async (req, res) => {
  const { title, description } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  try {
    const result = await db.query(
      `INSERT INTO superLessons (title, description) VALUES ($1, $2) RETURNING id, title, description`,
      [title.trim(), description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Chyba při vytváření super lesson:', err);
    res.status(500).json({ error: 'Chyba serveru při vytváření super lesson.' });
  }
});

app.patch('/api/super-lessons/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description } = req.body;
  try {
    const result = await db.query(
      `UPDATE superLessons SET title = COALESCE($1, title), description = $2, updated_at = NOW() WHERE id = $3 RETURNING id, title, description`,
      [title ? title.trim() : null, description ?? null, id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Nenalezeno' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Chyba při úpravě super lesson:', err);
    res.status(500).json({ error: 'Chyba serveru při úpravě super lesson.' });
  }
});

app.delete('/api/super-lessons/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM superLessons WHERE id = $1', [id]);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Chyba při mazání super lesson:', err);
    res.status(500).json({ error: 'Chyba serveru při mazání super lesson.' });
  }
});

// --- Sections ---
app.post('/api/sections', async (req, res) => {
  const { lessonId, title, position } = req.body;
  if (!lessonId) return res.status(400).json({ error: 'lessonId is required' });
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  try {
    const result = await db.query(
      `INSERT INTO sections (super_lesson_id, title, position) VALUES ($1, $2, $3) RETURNING id, title, position`,
[lessonId, title.trim(), position ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Chyba při vytváření sekce:', err);
    res.status(500).json({ error: 'Chyba serveru při vytváření sekce.' });
  }
});

app.patch('/api/sections/:id', async (req, res) => {
  const { id } = req.params;
  const { title, position } = req.body;
  try {
    const result = await db.query(
      `UPDATE sections SET title = COALESCE($1, title), position = COALESCE($2, position), updated_at = NOW() WHERE id = $3 RETURNING id, title, position`,
      [title ? title.trim() : null, position ?? null, id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Nenalezeno' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Chyba při úpravě sekce:', err);
    res.status(500).json({ error: 'Chyba serveru při úpravě sekce.' });
  }
});

app.delete('/api/sections/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM sections WHERE id = $1', [id]);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Chyba při mazání sekce:', err);
    res.status(500).json({ error: 'Chyba serveru při mazání sekce.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server běží na http://localhost:${PORT}`);
});
