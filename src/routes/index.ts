import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import adminAuthRoutes from '../modules/admin/admin.routes';
import adminUsersRoutes from '../modules/admin/admin-users.routes';
import creditRoutes from '../modules/credit/credit.routes';
import seedanceReelRoutes from '../modules/seedance-reel/seedance-reel.routes';
import actionReelRoutes from '../modules/action-reel/action-reel.routes';
import comedyReelRoutes from '../modules/comedy-reel/comedy-reel.routes';

const router : Router = Router();

router.use('/auth', authRoutes);
router.use('/admin/auth', adminAuthRoutes);
router.use('/admin/users', adminUsersRoutes);
router.use('/credits', creditRoutes);
router.use('/seedance-reel', seedanceReelRoutes);
router.use('/action-reel', actionReelRoutes);
router.use('/comedy-reel', comedyReelRoutes);

export default router;
