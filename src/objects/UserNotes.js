'use strict';
const _ = require('lodash');
const Promise = require('bluebird');
const zlib = require('zlib');

const UserNotes = class extends Array {
  static _inflate_blob (blob) {
    return Promise.promisify(zlib.inflate)(new Buffer(blob, 'base64')).then(JSON.parse);
  }
  static _deflate_blob (obj) {
    return Promise.promisify(zlib.deflate)(JSON.stringify(obj)).then(buf => buf.toString('base64'));
  }
  save ({reason = '', previous_revision} = {}) {
    return this._subreddit.get_wiki_page('usernotes').edit({reason, previous_revision, text: JSON.stringify(this.format())});
  }
  format () {
    return _.assign(this._context, {blob: UserNotes._deflate_blob(
      _(this).groupBy('user.name').mapValues(notes => ({ns: _.map(notes, note => note.format())})).value()
    )});
  }
  inspect () {
    return Array.from(this);
  }
};

module.exports = UserNotes;
