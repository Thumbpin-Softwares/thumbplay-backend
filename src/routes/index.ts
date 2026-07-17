import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import adminAuthRoutes from '../modules/admin/admin.routes';
import adminUsersRoutes from '../modules/admin/admin-users.routes';
import adminAvatarsRoutes from '../modules/admin/admin-avatars.routes';
import creditRoutes from '../modules/credit/credit.routes';
import seedanceReelRoutes from '../modules/seedance-reel/seedance-reel.routes';
import actionReelRoutes from '../modules/action-reel/action-reel.routes';
import comedyReelRoutes from '../modules/comedy-reel/comedy-reel.routes';
import reAvatarsRoutes from '../modules/re-avatars/re-avatars.routes';

const router : Router = Router();

router.use('/auth', authRoutes);
router.use('/admin/auth', adminAuthRoutes);
router.use('/admin/users', adminUsersRoutes);
router.use('/admin/avatars', adminAvatarsRoutes);
router.use('/credits', creditRoutes);
router.use('/seedance-reel', seedanceReelRoutes);
router.use('/action-reel', actionReelRoutes);
router.use('/comedy-reel', comedyReelRoutes);
router.use('/avatars', reAvatarsRoutes);

export default router;
