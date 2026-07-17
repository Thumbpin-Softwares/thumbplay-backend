import { Request, Response } from 'express';
import { User } from '../user/user.model';
import { Asset } from '../asset/asset.model';

// GET /admin/stats — port of thumbpinclient's GET handler. The old route
// also counted a separate `Video` collection, which belonged to an orphaned
// prototype feature (deleted) — video counts now come purely from Asset.
export async function stats(_req: Request, res: Response): Promise<void> {
  const [totalUsers, proUsers, totalVideos, totalAvatarAssets, recentUsers, creditStats] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ plan: 'pro' }),
    Promise.all([
      Asset.countDocuments({ type: 'video' }),
      Asset.countDocuments({ type: 'composite' }),
      Asset.countDocuments({ type: 'clip' }),
    ]).then((counts) => counts.reduce((a, b) => a + b, 0)),
    Asset.countDocuments({ type: 'avatar' }),
    User.find().sort({ createdAt: -1 }).limit(5).select('email name createdAt plan credits').lean(),
    User.aggregate([
      {
        $group: {
          _id: null,
          totalCredits: { $sum: '$credits' },
          avgCredits: { $avg: '$credits' },
        },
      },
    ]).catch(() => []),
  ]);

  res.status(200).json({
    stats: {
      totalUsers,
      freeUsers: totalUsers - proUsers,
      proUsers,
      totalVideos,
      totalAvatarAssets,
      totalCreditsInSystem: creditStats[0]?.totalCredits || 0,
      avgCreditsPerUser: Math.round(creditStats[0]?.avgCredits || 0),
    },
    recentUsers,
  });
}
