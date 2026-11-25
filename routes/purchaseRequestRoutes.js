const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const controller = require('../controllers/purchaseRequestController');
router.use(auth);
router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:id', controller.get);
router.patch('/:id/approval', controller.act);
module.exports = router;
