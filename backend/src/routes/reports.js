const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/reports/doctor-stats
router.get('/doctor-stats', authenticate, async (req, res) => {
  try {
    const start = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // FIX: Fetch all doctors once, then run all per-doctor queries in parallel
    const doctors = await prisma.doctor.findMany();

    const reportData = await Promise.all(
      doctors.map(async (doc) => {
        const [totalAppointments, completedAppointments, cancelledAppointments, todayQueueSize] =
          await Promise.all([
            prisma.appointment.count({ where: { doctorId: doc.id } }),
            prisma.appointment.count({ where: { doctorId: doc.id, status: 'COMPLETED' } }),
            prisma.appointment.count({ where: { doctorId: doc.id, status: 'CANCELLED' } }),
            prisma.queueToken.count({
              where: { doctorId: doc.id, createdAt: { gte: today } },
            }),
          ]);

        const revenue = completedAppointments * doc.consultationFee;

        return {
          id: doc.id,
          name: doc.name,
          specialization: doc.specialization,
          department: doc.department,
          totalAppointments,
          completedAppointments,
          cancelledAppointments,
          todayQueueSize,
          revenue,
        };
      })
    );

    res.json({ success: true, timeTakenMs: Date.now() - start, data: reportData });
  } catch (error) {
    console.error('[reports] GET /doctor-stats error:', error);
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});

module.exports = router;

