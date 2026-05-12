const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  channel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Channel',
    required: true
  },
  initiator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  participants: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    joinedAt: { type: Date, default: Date.now },
    leftAt: Date,
    isMuted: { type: Boolean, default: false },
    isDeafened: { type: Boolean, default: false },
    isVideo: { type: Boolean, default: false },
    isScreenSharing: { type: Boolean, default: false }
  }],
  status: {
    type: String,
    enum: ['ringing', 'active', 'ended'],
    default: 'ringing'
  },
  type: {
    type: String,
    enum: ['voice', 'video'],
    default: 'voice'
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  endedAt: Date,
  duration: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model('Call', callSchema);
