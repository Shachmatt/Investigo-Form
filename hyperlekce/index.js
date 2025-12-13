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
    // SQL DOTAZ: Znovu explicitně vybíráme VŠECHNY potřebné sloupce.
    const result = await db.query(`
        SELECT 
          sl.id AS super_id, sl.title AS super_title, sl.description,
          s.id AS section_id, s.title AS section_title, s.position AS section_position,
          
          -- Tabulka 'lessons' (l) - Všechny sloupce
          l.id AS lesson_id, l.title AS lesson_title, l.intro, l.before_exercise, l.outro, l.section_id, 
          l.created_at AS lesson_created_at, l.updated_at AS lesson_updated_at,
          
          -- Tabulka 'exercises' (e) - Všechny sloupce
          e.id AS exercise_id, e.lesson_id, e.type AS exercise_type, e.question AS exercise_question, 
          e.created_at AS exercise_created_at,
          
          -- Tabulka 'exercise_data' (ed) - Všechny sloupce
          ed.id AS data_id, ed.exercise_id AS data_exercise_id, ed.data AS exercise_data_content
        FROM superLessons sl
        LEFT JOIN sections s ON s.super_lesson_id = sl.id
        LEFT JOIN lessons l ON l.section_id = s.id
        LEFT JOIN exercises e ON e.lesson_id = l.id
        LEFT JOIN exercise_data ed ON ed.exercise_id = e.id
        
        ORDER BY sl.id ASC, s.position NULLS LAST, s.id ASC, l.id ASC, e.id ASC
      `);

    const map = new Map();

    result.rows.forEach(row => {
      // 1. SUPER LESSON
      if (!map.has(row.super_id)) {
        map.set(row.super_id, {
          id: String(row.super_id),
          title: row.super_title,
          description: row.description,
          sections: [],
          _sectionsMap: new Map()
        });
      }
      const currentSuper = map.get(row.super_id);

      // 2. SECTION
      if (row.section_id) {
        if (!currentSuper._sectionsMap.has(row.section_id)) {
          const newSection = {
            id: String(row.section_id),
            title: row.section_title,
            position: row.section_position,
            exercises: [], // Frontend očekává pole "cvičení" (naše Lessons)
            _lessonsMap: new Map()
          };
          currentSuper.sections.push(newSection);
          currentSuper._sectionsMap.set(row.section_id, newSection);
        }
        const currentSection = currentSuper._sectionsMap.get(row.section_id);

        // 3. LESSON (Frontend "exercise")
        if (row.lesson_id) {
          if (!currentSection._lessonsMap.has(row.lesson_id)) {
            // Tady mapujeme VŠECHNY sloupce z lessons (l)
            const newLesson = {
              id: String(row.lesson_id),
              label: row.lesson_title || 'Neznámá lekce', 
              
              // >>> KOMPLETNÍ DATA Z lessons TADY <<<
              lesson_all_data: {
                id: String(row.lesson_id),
                title: row.lesson_title,
                intro: row.intro,
                before_exercise: row.before_exercise,
                outro: row.outro,
                section_id: String(row.section_id),
                created_at: row.lesson_created_at,
                updated_at: row.lesson_updated_at,
              },
              exercises: [] // Pole skutečných Cvičení (e + ed)
            };
            currentSection.exercises.push(newLesson);
            currentSection._lessonsMap.set(row.lesson_id, newLesson);
          }
          const currentLesson = currentSection._lessonsMap.get(row.lesson_id);

          // 4. EXERCISE + DATA
          if (row.exercise_id) {
            const existingExercise = currentLesson.exercises.find(ex => ex.id === row.exercise_id);
            if (!existingExercise) {
                // Tady mapujeme VŠECHNY sloupce z exercises (e) a exercise_data (ed)
                currentLesson.exercises.push({
                    id: String(row.exercise_id),
                    // >>> KOMPLETNÍ DATA Z exercises A exercise_data TADY <<<
                    exercise_all_data: {
                        // Data z exercises
                        id: String(row.exercise_id),
                        lesson_id: String(row.lesson_id),
                        type: row.exercise_type,
                        question: row.exercise_question,
                        created_at: row.exercise_created_at,
                        // Data z exercise_data
                        data_id: row.data_id,
                        data_exercise_id: row.data_exercise_id,
                        data_content: row.exercise_data_content // toto je sloupec 'data'
                    }
                });
            }
          }
        }
      }
    });

    // Úklid pomocných map a odeslání
    const finalData = Array.from(map.values()).map(sl => {
        delete sl._sectionsMap;
        sl.sections = sl.sections.map(sec => {
            delete sec._lessonsMap;
            return sec;
        });
        return sl;
    });

    res.json(finalData);

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
