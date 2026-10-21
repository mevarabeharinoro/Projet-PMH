const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'infoarret_db',
  password: '9099',
  port: 5432,
});

app.get('/arrets', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nom, latitude, longitude, direction, zone_id FROM arrets ORDER BY id'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

//CRUD
app.put('/bus/:id/etat', async (req, res) => {
  const { id } = req.params;
  const { etat } = req.body;
  try {
    const result = await pool.query(
      `UPDATE bus SET etat = $1 WHERE id = $2 RETURNING *`,
      [etat, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bus non trouvé' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

function calculerDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function chargerCycle(numLigne) {
  const r = await pool.query(
    `SELECT t.ordre, t.arret_id, a.nom, a.latitude, a.longitude
     FROM trajets t JOIN arrets a ON a.id = t.arret_id
     WHERE t.num_ligne = $1 ORDER BY t.ordre`,
    [numLigne]
  );
  return r.rows;
}

function pointsTroncon(a, b, noeuds) {
  let inter = noeuds
    .filter((n) => n.arret_depart_id === a.arret_id && n.arret_arrivee_id === b.arret_id)
    .sort((x, y) => x.rang - y.rang);
  if (inter.length === 0) {
    inter = noeuds
      .filter((n) => n.arret_depart_id === b.arret_id && n.arret_arrivee_id === a.arret_id)
      .sort((x, y) => y.rang - x.rang);
  }
  return [a, ...inter, b].map((p) => ({ lat: p.latitude, lon: p.longitude }));
}

function longueurTronconKm(a, b, noeuds) {
  const pts = pointsTroncon(a, b, noeuds);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += calculerDistanceKm(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon);
  }
  return total;
}

function distanceDansCycleKm(stops, noeuds, i, j) {
  let total = 0;
  let k = i;
  while (k !== j) {
    const suivant = (k + 1) % stops.length;
    total += longueurTronconKm(stops[k], stops[suivant], noeuds);
    k = suivant;
  }
  return total;
}

function trouverDirection(stops, fromId, toId) {
  const n = stops.length;
  let meilleur = null;
  stops.forEach((s, i) => {
    if (s.arret_id !== fromId) return;
    stops.forEach((t, j) => {
      if (t.arret_id !== toId) return;
      const pas = (j - i + n) % n;
      if (pas > 0 && (meilleur === null || pas < meilleur.pas)) {
        meilleur = { fromIdx: i, toIdx: j, pas };
      }
    });
  });
  return meilleur;
}

app.get('/bus/:busId/eta/:arretId', async (req, res) => {
  const { busId, arretId } = req.params;
  try {
    const busResult = await pool.query('SELECT * FROM bus WHERE id = $1', [busId]);
    const arretResult = await pool.query('SELECT * FROM arrets WHERE id = $1', [arretId]);

    if (busResult.rows.length === 0 || arretResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bus ou arrêt non trouvé' });
    }

    const bus = busResult.rows[0];
    const arret = arretResult.rows[0];

    if (bus.etat !== 'marche') {
      return res.status(200).json({ message: `Le bus n'est pas en marche (état: ${bus.etat})`, eta: null });
    }

    const distanceKm = calculerDistanceKm(bus.latitude, bus.longitude, arret.latitude, arret.longitude);
    const tempsHeures = distanceKm / bus.vitesse;
    const tempsMinutes = Math.round(tempsHeures * 60);

    res.json({ distanceKm: distanceKm.toFixed(2), etaMinutes: tempsMinutes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul' });
  }
});

app.get('/bus', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bus ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des bus' });
  }
});

app.get('/trajets', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.num_ligne, t.ordre, t.arret_id, a.nom
       FROM trajets t JOIN arrets a ON a.id = t.arret_id
       ORDER BY t.num_ligne, t.ordre`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des trajets' });
  }
});

const PAUSE_ARRET_S = 120; 
const FACTEUR_SIMULATION = 1;

const cacheGeometrie = {};

async function geometrieLigne(numLigne) {
  const c = cacheGeometrie[numLigne];
  if (c && Date.now() - c.t < 10000) return c.geo;
  const stops = await chargerCycle(numLigne);
  const noeuds = (await pool.query('SELECT * FROM noeuds')).rows;
  const segs = stops.map((s, k) => {
    const pts = pointsTroncon(s, stops[(k + 1) % stops.length], noeuds);
    const lengths = [];
    for (let i = 0; i < pts.length - 1; i++) {
      lengths.push(calculerDistanceKm(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon));
    }
    return { pts, lengths, L: lengths.reduce((a, b) => a + b, 0) };
  });
  const geo = { stops, segs };
  cacheGeometrie[numLigne] = { t: Date.now(), geo };
  return geo;
}

function calculerTimeline(geo, vitesseKmh) {
  const arrivees = [];
  const departs = [];
  let t = 0;
  geo.segs.forEach((seg) => {
    arrivees.push(t);
    departs.push(t + PAUSE_ARRET_S);
    t += PAUSE_ARRET_S + (seg.L / vitesseKmh) * 3600;
  });
  return { arrivees, departs, T: t };
}

function positionA(geo, tl, tau) {
  const n = geo.segs.length;
  let k = n - 1;
  for (let i = 0; i < n; i++) {
    const finI = i + 1 < n ? tl.arrivees[i + 1] : tl.T;
    if (tau < finI) { k = i; break; }
  }
  const stop = geo.stops[k];
  const aLArret = { lat: stop.latitude, lon: stop.longitude, ordre: stop.ordre };
  if (tau < tl.departs[k]) return aLArret;

  const seg = geo.segs[k];
  const fin = k + 1 < n ? tl.arrivees[k + 1] : tl.T;
  if (fin <= tl.departs[k]) return aLArret;
  let reste = ((tau - tl.departs[k]) / (fin - tl.departs[k])) * seg.L;
  for (let i = 0; i < seg.lengths.length; i++) {
    if (reste <= seg.lengths[i] || i === seg.lengths.length - 1) {
      const f = seg.lengths[i] > 0 ? Math.min(1, reste / seg.lengths[i]) : 0;
      const a = seg.pts[i];
      const b = seg.pts[i + 1];
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, ordre: stop.ordre };
    }
    reste -= seg.lengths[i];
  }
  return aLArret;
}

let dernierTick = Date.now();
async function tickSimulation() {
  const maintenant = Date.now();
  const dt = ((maintenant - dernierTick) / 1000) * FACTEUR_SIMULATION;
  dernierTick = maintenant;
  try {
    const buses = (await pool.query("SELECT * FROM bus WHERE etat = 'marche'")).rows;
    for (const b of buses) {
      const geo = await geometrieLigne(b.num_ligne);
      if (geo.segs.length === 0 || !(b.vitesse > 0)) continue;
      const tl = calculerTimeline(geo, b.vitesse);
      const tau = ((b.temps_cycle_s || 0) + dt) % tl.T;
      const pos = positionA(geo, tl, tau);
      await pool.query(
        'UPDATE bus SET temps_cycle_s = $1, latitude = $2, longitude = $3, ordre_actuel = $4, maj_a = NOW() WHERE id = $5',
        [tau, pos.lat, pos.lon, pos.ordre, b.id]
      );
    }
  } catch (err) {
    console.error('Simulation :', err.message);
  }
}

app.get('/trajet', async (req, res) => {
  const fromId = Number(req.query.fromId);
  const toId = Number(req.query.toId);
  if (!fromId || !toId) {
    return res.status(400).json({ error: 'Départ et destination requis' });
  }
  try {
    const buses = (await pool.query('SELECT * FROM bus ORDER BY id')).rows;
    const resultats = [];
    for (const b of buses) {
      const geo = await geometrieLigne(b.num_ligne);
      const dir = trouverDirection(geo.stops, fromId, toId);
      if (!dir) continue;

      const base = { busId: b.id, numLigne: b.num_ligne, latitude: b.latitude, longitude: b.longitude, numBus: b.num_bus };
      if (b.etat !== 'marche') {
        resultats.push({ ...base, message: `Pas en marche (${b.etat})`, etaMinutes: null });
        continue;
      }

      const tl = calculerTimeline(geo, b.vitesse);
      const tau = b.temps_cycle_s || 0;
      const arrivee = tl.arrivees[dir.fromIdx];
      const attente =
        tau >= arrivee && tau < tl.departs[dir.fromIdx] ? 0 : (arrivee - tau + tl.T) % tl.T;
      const minutes = attente === 0 ? 0 : Math.max(1, Math.ceil(attente / FACTEUR_SIMULATION / 60));
      resultats.push({ ...base, etaMinutes: minutes });
    }

    if (resultats.length === 0) {
      return res.status(404).json({ error: 'Aucune ligne directe ne dessert ce trajet' });
    }
    res.json(resultats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la recherche du trajet' });
  }
});
app.get('/zones/localiser', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'Position requise' });
  }
  try {
    const z = await pool.query(
      `SELECT id, nom FROM zones
       WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) LIMIT 1`,
      [lon, lat]
    );
    if (z.rows.length === 0) {
      return res.json({ zone: null, message: 'Vous êtes hors de la zone couverte' });
    }
    const p = await pool.query(
      `SELECT id, nom,
              ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m
       FROM arrets WHERE zone_id = $3
       ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326) LIMIT 1`,
      [lon, lat, z.rows[0].id]
    );
    res.json({
      zone: z.rows[0],
      arretProche: p.rows[0] ? { id: p.rows[0].id, nom: p.rows[0].nom } : null,
      distanceM: p.rows[0] ? Math.round(p.rows[0].distance_m) : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la localisation' });
  }
});

app.get('/zones', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT z.id, z.nom, COUNT(a.id)::int AS nb_arrets
       FROM zones z LEFT JOIN arrets a ON a.zone_id = z.id
       GROUP BY z.id ORDER BY z.id`
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des zones' });
  }
});

app.get('/zones/:id/arrets', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, nom, latitude, longitude FROM arrets WHERE zone_id = $1 ORDER BY id',
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des arrêts' });
  }
});

app.get('/zones/:id/bus', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.* FROM bus b
       JOIN lignes_zones lz ON lz.num_ligne = b.num_ligne
       WHERE lz.zone_id = $1 ORDER BY b.id`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des bus' });
  }
});

app.get('/zones/:id/bus/presents', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.id, b.num_ligne, b.num_bus, b.latitude, b.longitude, b.etat
       FROM bus b JOIN zones z ON z.id = $1
       WHERE b.etat = 'marche'
         AND ST_Contains(z.geom, ST_SetSRID(ST_MakePoint(b.longitude, b.latitude), 4326))
       ORDER BY b.id`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des bus' });
  }
});

app.get('/itineraire', async (req, res) => {
  const zoneId = Number(req.query.zoneId);
  const toId = Number(req.query.toId);
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const aPosition = Number.isFinite(lat) && Number.isFinite(lon);
  if (!zoneId || !toId) {
    return res.status(400).json({ error: "Zone d'origine et arrêt de destination requis" });
  }
  try {
    const arretsZone = (
      await pool.query('SELECT id, nom, latitude, longitude FROM arrets WHERE zone_id = $1 AND id <> $2', [zoneId, toId])
    ).rows;
    const buses = (await pool.query("SELECT * FROM bus WHERE etat = 'marche' ORDER BY id")).rows;
    const resultats = [];

    for (const b of buses) {
      const geo = await geometrieLigne(b.num_ligne);

      const candidats = [];
      for (const a of arretsZone) {
        const dir = trouverDirection(geo.stops, a.id, toId);
        if (dir) candidats.push({ a, dir });
      }
      if (candidats.length === 0) continue;

      let choix = candidats[0];
      let distanceMarcheM = null;
      if (aPosition) {
        let dmin = Infinity;
        for (const c of candidats) {
          const km = calculerDistanceKm(lat, lon, c.a.latitude, c.a.longitude);
          if (km < dmin) { dmin = km; choix = c; }
        }
        distanceMarcheM = Math.round(dmin * 1000);
      }

      const tl = calculerTimeline(geo, b.vitesse);
      const tau = b.temps_cycle_s || 0;
      const arrivee = tl.arrivees[choix.dir.fromIdx];
      const attente =
        tau >= arrivee && tau < tl.departs[choix.dir.fromIdx] ? 0 : (arrivee - tau + tl.T) % tl.T;
      const etaMinutes = attente === 0 ? 0 : Math.max(1, Math.ceil(attente / FACTEUR_SIMULATION / 60));

      resultats.push({
        busId: b.id,
        numLigne: b.num_ligne,
        numBus: b.num_bus,
        latitude: b.latitude,
        longitude: b.longitude,
        arretMontee: choix.a,
        distanceMarcheM,
        etaMinutes,
      });
    }

    if (resultats.length === 0) {
      return res.status(404).json({ error: 'Aucun bus en marche ne relie cette zone à cet arrêt' });
    }
    resultats.sort((x, y) => x.etaMinutes - y.etaMinutes);
    res.json(resultats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la recherche d'itinéraire" });
  }
});

app.get('/zones/geojson', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, nom, ST_AsGeoJSON(geom)::json AS geometry FROM zones WHERE geom IS NOT NULL ORDER BY id`
    );
    res.json({
      type: 'FeatureCollection',
      features: r.rows.map((z) => ({
        type: 'Feature',
        properties: { id: z.id, nom: z.nom },
        geometry: z.geometry,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des zones' });
  }
});

app.get('/ligne/:numLigne/chemin', async (req, res) => {
  try {
    const geo = await geometrieLigne(req.params.numLigne);
    const chemin = [];
    geo.segs.forEach((seg) => seg.pts.forEach((p) => chemin.push([p.lat, p.lon])));
    const arrets = [
      ...new Map(
        geo.stops.map((s) => [
          s.arret_id,
          { id: s.arret_id, nom: s.nom, latitude: s.latitude, longitude: s.longitude },
        ])
      ).values(),
    ];
    res.json({ chemin, arrets });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du tracé' });
  }
});

app.put('/bus/:id/position', async (req, res) => {
  const { id } = req.params;
  const { ordre } = req.body;
  try {
    const b = (await pool.query('SELECT * FROM bus WHERE id = $1', [id])).rows[0];
    if (!b) return res.status(404).json({ error: 'Bus non trouvé' });
    const geo = await geometrieLigne(b.num_ligne);
    const k = geo.stops.findIndex((s) => s.ordre === ordre);
    if (k === -1) return res.status(404).json({ error: 'Étape non trouvée' });
    const tl = calculerTimeline(geo, b.vitesse);
    const tau = tl.arrivees[k];
    const pos = positionA(geo, tl, tau);
    const result = await pool.query(
      'UPDATE bus SET temps_cycle_s = $1, latitude = $2, longitude = $3, ordre_actuel = $4, maj_a = NOW() WHERE id = $5 RETURNING *',
      [tau, pos.lat, pos.lon, pos.ordre, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du déplacement du bus' });
  }
});

const ETATS = ['marche', 'arret', 'panne', 'transfert', 'school', 'plein'];

function indexLePlusProche(geo, tl, tau, arretId) {
  let meilleur = -1;
  let ecart = Infinity;
  geo.stops.forEach((s, k) => {
    if (s.arret_id !== arretId) return;
    const d = Math.abs(tl.arrivees[k] - tau);
    const dc = Math.min(d, tl.T - d);
    if (dc < ecart) { ecart = dc; meilleur = k; }
  });
  return meilleur;
}

app.get('/lignes', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT t.num_ligne, MAX(b.nom_ligne) AS nom_ligne
       FROM trajets t LEFT JOIN bus b ON b.num_ligne = t.num_ligne
       GROUP BY t.num_ligne ORDER BY t.num_ligne`
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des lignes' });
  }
});

app.post('/signalements', async (req, res) => {
  const { numLigne, arretId, numBus, etat, latitude, longitude } = req.body;
  if (!numLigne || !arretId || !numBus || !ETATS.includes(etat)) {
    return res.status(400).json({ error: 'Champs manquants ou invalides' });
  }
  try {
    const arret = Number(arretId);
    const geo = await geometrieLigne(numLigne);
    const premier = geo.stops.findIndex((s) => s.arret_id === arret);
    if (premier === -1) {
      return res.status(400).json({ error: "Cet arrêt n'est pas sur cette ligne" });
    }

    let bus = (
      await pool.query('SELECT * FROM bus WHERE num_bus = $1 AND num_ligne = $2', [numBus, numLigne])
    ).rows[0];
    const cree = !bus;
    const vitesse = bus && bus.vitesse > 0 ? bus.vitesse : 18;
    const tl = calculerTimeline(geo, vitesse);
    const k = bus ? indexLePlusProche(geo, tl, bus.temps_cycle_s || 0, arret) : premier;
    const tau = tl.arrivees[k];
    const pos = positionA(geo, tl, tau);

    if (cree) {
      const ligne = (await pool.query('SELECT nom_ligne FROM bus WHERE num_ligne = $1 LIMIT 1', [numLigne])).rows[0];
      bus = (
        await pool.query(
          `INSERT INTO bus (nom_ligne, num_ligne, num_bus, latitude, longitude, vitesse, etat, ordre_actuel, temps_cycle_s, maj_a)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING *`,
          [ligne ? ligne.nom_ligne : `Ligne ${numLigne}`, numLigne, numBus, pos.lat, pos.lon, vitesse, etat, pos.ordre, tau]
        )
      ).rows[0];
    } else {
      bus = (
        await pool.query(
          `UPDATE bus SET latitude = $1, longitude = $2, ordre_actuel = $3, temps_cycle_s = $4, etat = $5, maj_a = NOW()
           WHERE id = $6 RETURNING *`,
          [pos.lat, pos.lon, pos.ordre, tau, etat, bus.id]
        )
      ).rows[0];
    }

    await pool.query(
      'INSERT INTO signalements (bus_id, arret_id, etat, latitude, longitude) VALUES ($1, $2, $3, $4, $5)',
      [bus.id, arret, etat, latitude ?? null, longitude ?? null]
    );
    res.status(201).json({ bus, cree });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du signalement" });
  }
});

app.post('/retours', async (req, res) => {
  const { busId, arretId, statut, etaPrevue } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO retours (bus_id, arret_id, statut, eta_prevue_min) VALUES ($1, $2, $3, $4) RETURNING *`,
      [busId, arretId, statut, etaPrevue ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du retour" });
  }
});

app.use(express.static(path.join(__dirname, '../infosarret/www')));

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, '../infosarret/www/index.html'));
});

app.listen(3000, () => {
  console.log('API démarrée sur http://localhost:3000');
});

setInterval(tickSimulation, 1000);