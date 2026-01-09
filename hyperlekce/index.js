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

    console.log('GET /api/data - Total rows returned:', result.rows.length);
    const sectionsForSuper3 = result.rows.filter(r => r.super_id === 3 && r.section_id);
    console.log('GET /api/data - Rows for super_id=3 with sections:', sectionsForSuper3.length);
    if (sectionsForSuper3.length > 0) {
      console.log('GET /api/data - Sample section rows:', sectionsForSuper3.slice(0, 3).map(r => ({
        super_id: r.super_id,
        section_id: r.section_id,
        section_title: r.section_title,
        lesson_id: r.lesson_id
      })));
    }

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

    const super3 = finalData.find(sl => String(sl.id) === '3');
    if (super3) {
      console.log('GET /api/data - Final data for super_id=3:', {
        id: super3.id,
        title: super3.title,
        sectionsCount: super3.sections.length,
        sections: super3.sections.map(s => ({ id: s.id, title: s.title }))
      });
    }

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
  console.log('POST /api/sections - Received request:', req.body);
  const { lessonId, title, position } = req.body;
  if (!lessonId) {
    console.log('POST /api/sections - Validation failed: lessonId is required');
    return res.status(400).json({ error: 'lessonId is required' });
  }
  if (!title?.trim()) {
    console.log('POST /api/sections - Validation failed: title is required');
    return res.status(400).json({ error: 'title is required' });
  }

  try {
    console.log('POST /api/sections - Attempting database insert with:', { lessonId, title: title.trim(), position: position ?? null });
    const result = await db.query(
      `INSERT INTO sections (super_lesson_id, title, position) VALUES ($1, $2, $3) RETURNING id, title, position`,
      [lessonId, title.trim(), position ?? null]
    );
    console.log('POST /api/sections - Successfully inserted section:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/sections - Database error:', err);
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



// --- ENDPOINTY PRO ÚPRAVU A MAZÁNÍ LEKCÍ (LESSONS) ---

// 1. MAZÁNÍ LEKCE (DELETE)
app.delete('/api/lessons/:lessonId', async (req, res) => {
  const { lessonId } = req.params;
  const client = await db.connect();
  try {
      await client.query('BEGIN');

      // Nejdřív smažeme data a cvičení, které na Lekci odkazují
      // Předpoklad: CASCADE DELETES jsou již nastaveny v DB, ale je bezpečnější to udělat explicitně.
      // Pokud má Lessons ID 1, a Exercises má lesson_id 1, smažeme všechna cvičení v této lekci.
      await client.query('DELETE FROM exercises WHERE lesson_id = $1', [lessonId]);
      
      // Nyní smažeme samotnou lekci
      const result = await client.query('DELETE FROM lessons WHERE id = $1 RETURNING id', [lessonId]);

      await client.query('COMMIT');

      if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Lekce nenalezena.' });
      }
      res.status(204).send(); // 204 No Content pro úspěšné mazání

  } catch (err) {
      await client.query('ROLLBACK');
      console.error('Chyba při mazání lekce:', err);
      res.status(500).json({ error: 'Chyba serveru při mazání lekce.' });
  } finally {
      client.release();
  }
});


// 2. ÚPRAVA LEKCE (PATCH)
app.patch('/api/lessons/:lessonId', async (req, res) => {
  const { lessonId } = req.params;
  const { title, intro, before_exercise, outro } = req.body;
  
  // Vytvoření dynamické sady pro SQL dotaz
  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
  }
  if (intro !== undefined) {
      updates.push(`intro = $${paramIndex++}`);
      values.push(intro);
  }
  if (before_exercise !== undefined) {
      updates.push(`before_exercise = $${paramIndex++}`);
      values.push(before_exercise);
  }
  if (outro !== undefined) {
      updates.push(`outro = $${paramIndex++}`);
      values.push(outro);
  }

  if (updates.length === 0) {
      return res.status(400).json({ error: 'Žádné parametry pro úpravu nebyly poskytnuty.' });
  }

  const setClause = updates.join(', ');
  values.push(lessonId); // Poslední hodnota je ID lekce
  
  const query = `
      UPDATE lessons
      SET ${setClause}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING *;
  `;

  try {
      const result = await db.query(query, values);
      if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Lekce nenalezena.' });
      }
      res.json(result.rows[0]);

  } catch (err) {
      console.error('Chyba při úpravě lekce:', err);
      res.status(500).json({ error: 'Chyba serveru při úpravě lekce.' });
  }
});


// --- ENDPOINTY PRO ÚPRAVU A MAZÁNÍ CVIČENÍ (EXERCISES) ---

// 3. MAZÁNÍ CVIČENÍ (DELETE)
app.delete('/api/exercises/:exerciseId', async (req, res) => {
  const { exerciseId } = req.params;
  const client = await db.connect();
  try {
      await client.query('BEGIN');

      // Předpokládáme, že exercise_data odkazuje na exercises.
      // Smažeme data cvičení (exercise_data)
      await client.query('DELETE FROM exercise_data WHERE exercise_id = $1', [exerciseId]);
      
      // Nyní smažeme samotné cvičení (exercises)
      const result = await client.query('DELETE FROM exercises WHERE id = $1 RETURNING id', [exerciseId]);

      await client.query('COMMIT');

      if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Cvičení nenalezeno.' });
      }
      res.status(204).send(); // 204 No Content pro úspěšné mazání

  } catch (err) {
      await client.query('ROLLBACK');
      console.error('Chyba při mazání cvičení:', err);
      res.status(500).json({ error: 'Chyba serveru při mazání cvičení.' });
  } finally {
      client.release();
  }
});


// 4. ÚPRAVA CVIČENÍ (PATCH)
app.patch('/api/exercises/:exerciseId', async (req, res) => {
  const { exerciseId } = req.params;
  const { type, question, data_content } = req.body; // data_content je naše exercise_data.data
  const client = await db.connect();

  try {
      await client.query('BEGIN');
      
      // --- 1. Aktualizace tabulky 'exercises' (type, question) ---
      const ex_updates = [];
      const ex_values = [];
      let ex_paramIndex = 1;

      if (type !== undefined) {
          ex_updates.push(`type = $${ex_paramIndex++}`);
          ex_values.push(type);
      }
      if (question !== undefined) {
          ex_updates.push(`question = $${ex_paramIndex++}`);
          ex_values.push(question);
      }

      if (ex_updates.length > 0) {
          const ex_setClause = ex_updates.join(', ');
          ex_values.push(exerciseId);
          const ex_query = `
              UPDATE exercises
              SET ${ex_setClause}
              WHERE id = $${ex_paramIndex}
              RETURNING id;
          `;
          await client.query(ex_query, ex_values);
      }
      
      // --- 2. Aktualizace tabulky 'exercise_data' (data_content) ---
      if (data_content !== undefined) {
          // Použijeme UPSERT (INSERT OR UPDATE) logiku, abychom zajistili, že data existují.
          // Předpoklad: exercise_data.id je primární klíč a exercise_id je unikátní.
          // Pokud víme, že existuje 1:1 vztah, použijeme UPDATE.
          const data_result = await client.query(
              `UPDATE exercise_data SET data = $1 WHERE exercise_id = $2 RETURNING id`,
              [data_content, exerciseId]
          );

          // Pokud update neproběhl (žádný řádek nenalezen), provedeme INSERT
          if (data_result.rowCount === 0) {
              await client.query(
                  `INSERT INTO exercise_data (exercise_id, data) VALUES ($1, $2)`,
                  [exerciseId, data_content]
              );
          }
      }
      
      await client.query('COMMIT');

      // Zkontrolujeme, zda bylo aspoň jedno z polí aktualizováno
      if (ex_updates.length === 0 && data_content === undefined) {
          return res.status(400).json({ error: 'Žádné parametry pro úpravu nebyly poskytnuty.' });
      }

      res.json({ message: 'Cvičení a jeho data byla úspěšně aktualizována.' });

  } catch (err) {
      await client.query('ROLLBACK');
      console.error('Chyba při úpravě cvičení:', err);
      res.status(500).json({ error: 'Chyba serveru při úpravě cvičení.' });
  } finally {
      client.release();
  }
});



app.listen(PORT, () => {
  console.log(`Server běží na http://localhost:${PORT}`);
});
