import { Router } from 'express';
import { query } from '../config/db.js';
import { auth } from '../middleware/auth.js';
const r=Router();
r.get('/',auth,async(req,res)=>res.json((await query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id])).rows));
r.patch('/:id/read',auth,async(req,res)=>res.json((await query('UPDATE notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *',[req.params.id,req.user.id])).rows[0]||{}));
export default r;
