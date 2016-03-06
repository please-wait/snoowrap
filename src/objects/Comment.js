'use strict';
/**
* A class representing a reddit comment
* @extends VoteableContent
*/
const Comment = class extends require('./VoteableContent') {
  get _uri () {
    return `api/info?id=${this.name}`;
  }
  _transform_api_response (response_obj) {
    const replies_uri = `comments/${response_obj[0].link_id.slice(3)}`;
    const replies_query = {comment: this.id};
    const _transform = item => item.comments[0].replies;
    response_obj[0].replies = this._ac._new_object('Listing', {uri: replies_uri, query: replies_query, _transform});
    return response_obj[0];
  }
};

module.exports = Comment;
