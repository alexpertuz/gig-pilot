import { Router } from 'express';
import { queryLeads } from '../lib/cli.mjs';

const r = Router();
r.get('/', async (req, res) => {
  try {
    const leads = await queryLeads({ status: req.query.status, limit: req.query.limit });
    res.json({ leads });
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
});
export default r;
