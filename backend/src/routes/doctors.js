const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/doctors
// Retrieve list of doctors with optional search and specialization filtering
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, specialization } = req.query;

    const doctors = await prisma.doctor.findMany({
      where: {
        AND: [
          search ? { name: { contains: search, mode: 'insensitive' } } : {},
          specialization && specialization !== 'All' ? { specialization } : {},
        ],
      },
    });

    res.json(doctors);
  } catch (error) {
    console.error('[doctors] GET / error:', error);
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});

// GET /api/doctors/stats
// Returns aggregation details about available doctors
router.get('/stats', authenticate, async (req, res) => {
  try {
    const start = Date.now();

    // FIX: Run all independent queries in parallel with Promise.all
    const [totalDoctors, surgeonsCount, averageFee, highestExperience] = await Promise.all([
      prisma.doctor.count(),
      prisma.doctor.count({ where: { department: 'Surgery' } }),
      prisma.doctor.aggregate({ _avg: { consultationFee: true } }),
      prisma.doctor.aggregate({ _max: { experience: true } }),
    ]);

    res.json({
      success: true,
      data: {
        total: totalDoctors,
        surgeons: surgeonsCount,
        averageFee: Math.round(averageFee._avg.consultationFee || 0),
        maxExperience: highestExperience._max.experience || 0,
      },
      debugInfo: { executionTimeMs: Date.now() - start },
    });
  } catch (error) {
    console.error('[doctors] GET /stats error:', error);
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});

// GET /api/doctors/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const doctor = await prisma.doctor.findUnique({
      where: { id: req.params.id },
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    res.json(doctor);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
