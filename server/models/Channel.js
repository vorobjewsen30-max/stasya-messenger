const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    minlength: 2,
    maxlength: 50
  },
  type: {
    type: String,
    enum: ['text', 'voice', 'dm', 'group'],
    default: 'text'
  },
  description: {
    type: String,
    default: '',
    maxlength: 500
  },
  icon: {
    type: String,
    default: ''
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  members: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: ['owner', 'admin', 'moderator', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now }
  }],
  isPublic: {
    type: Boolean,
    default: false
  },
  inviteCode: {
    type: String,
    unique: true,
    sparse: true
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Генерация инвайт-кода
channelSchema.methods.generateInvite = function() {
  const crypto = require('crypto');
  this.inviteCode = crypto.randomBytes(6).toString('hex');
  return this.inviteCode;
};

module.exports = mongoose.model('Channel', channelSchema);
