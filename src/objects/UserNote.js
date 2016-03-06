'use strict';
const _ = require('lodash');
const UserNote = class {
  constructor ({n, t, m, l, w}, _ac, _context, _username) {
    this._context = _context;
    this.body = n;
    this.created_utc = t;
    this.author = _ac.get_user(_context.constants.users[m]);
    this.link = UserNote._parse_link(l, _ac);
    this.type = _context.constants.warnings[w];
    this.user = _ac.get_user(_username);
  }
  static _parse_link (l, _ac) {
    if (!l || !/^[ml]/.test(l)) {
      return null;
    }
    const parts = l.split(',');
    if (parts[0] === 'm') {
      return _ac.get_message(parts[1]);
    }
    if (parts.length === 3) {
      return _ac._new_object('Comment', {id: parts[2], link_id: `t3_${parts[1]}`});
    }
    return _ac.get_submission(parts[1]);
  }
  static _format_link (content) {
    if (content) {
      if (content.constructor.name === 'PrivateMessage') {
        return `m,${content.id}`;
      }
      if (content.constructor.name === 'Submission') {
        return `l,${content.id}`;
      }
      if (content.constructor.name === 'Comment') {
        return `l,${content.link_id},${content.id}`;
      }
    }
  }
  inspect () {
    return require('util').inspect(_.omitBy(this, (value, key) => key.startsWith('_')));
  }
  format () {
    const mod_index = this._context.constants.users.indexOf(this.author.name);
    const warning_index = this._context.constants.warnings.indexOf(this.type);
    return {
      n: this.body,
      t: this.created_utc,
      m: mod_index === -1 ? this._context.constants.users.push(this.author.name) - 1 : mod_index,
      l: UserNote._format_link(this.link),
      w: warning_index === -1 ? this._context.constants.warnings.push(this.type) - 1 : warning_index
    };
  }
};

module.exports = UserNote;
