const { Setting } = require('../models');
const { logAction } = require('../utils/auditLogger');

const getSettings = async (req, res) => {
  try {
    const rows = await Setting.findAll();
    const map = {};
    rows.forEach(r => { map[r.key] = r.value; });
    return res.json({ success: true, data: map });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch settings', error: error.message });
  }
};

const saveSettings = async (req, res) => {
  try {
    const entries = Object.entries(req.body || {});
    for (const [key, value] of entries) {
      const [row] = await Setting.findOrCreate({ where: { key }, defaults: { value: typeof value === 'object' ? JSON.stringify(value) : String(value) } });
      if (row) {
        row.value = typeof value === 'object' ? JSON.stringify(value) : String(value);
        await row.save();
      }
    }
    logAction(req.user.id, 'SAVE_SETTINGS', 'Setting', null, {}, req);
    return res.json({ success: true, message: 'Settings saved' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to save settings', error: error.message });
  }
};

module.exports = { getSettings, saveSettings };


