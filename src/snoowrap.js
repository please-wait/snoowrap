'use strict';
const Promise = require('bluebird');
const _ = require('lodash');
const promise_wrap = require('promise-chains');
const request_handler = require('./request_handler');
const constants = require('./constants');
const errors = require('./errors');
const helpers = require('./helpers');
const api_type = 'json';

/** The class for a snoowrap requester */
const snoowrap = class {
  /**
  * @summary Constructs a new requester. This will be necessary if you want to do anything.
  * @param {object} $0 An Object containing credentials.  This should have the properties (a) `user_agent`,
  `client_id`, `client_secret`, and `refresh_token`, **or** (b) `user_agent` and `access_token`.
  * @param {string} $0.user_agent A unique description of what your app does
  * @param {string} [$0.client_id] The client ID of your app (assigned by reddit)
  * @param {string} [$0.client_secret] The client secret of your app (assigned by reddit)
  * @param {string} [$0.refresh_token] A refresh token for your app. You will need to get this from reddit beforehand. A
  script to automatically generate refresh tokens for you can be found
  [here](https://github.com/not-an-aardvark/reddit-oauth-helper).
  * @param {string} [$0.access_token] An access token for your app. If this is provided, then the
  client ID/client secret/refresh token are not required. Note that all access tokens expire one hour after being
  generated; if you want to retain access for longer than that, provide the other credentials instead.
  */
  constructor ({user_agent, client_id, client_secret, refresh_token, access_token}) {
    if (!user_agent) {
      throw new errors.MissingUserAgentError();
    }
    if (!access_token && !(client_id && client_secret && refresh_token)) {
      throw new errors.NoCredentialsError();
    }
    this.user_agent = user_agent;
    this.client_id = client_id;
    this.client_secret = client_secret;
    this.refresh_token = refresh_token;
    this.access_token = access_token;
    this._config = require('./default_config');
    this._throttle = Promise.resolve();
  }
  static get name () {
    return constants.MODULE_NAME;
  }
  _new_object (object_type, content, _has_fetched) {
    if (Array.isArray(content)) {
      return content;
    }
    return new snoowrap.objects[object_type](content, this, _has_fetched);
  }
  /**
  * @summary Retrieves or modifies the configuration options for this requester.
  * @param {object} [options] A map of `{[config property name]: value}`. Note that any omitted config properties will simply
  retain whatever value they had previously (In other words, if you only want to change one property, you only need to put
  that one property in this parameter. To get the current configuration without modifying anything, simply omit this
  parameter.)
  * @param {string} [options.endpoint_domain='reddit.com'] The endpoint where requests should be sent
  * @param {string} [options.request_delay=0] A minimum delay, in milliseconds, to enforce between API calls. If multiple
  api calls are requested during this timespan, they will be queued and sent one at a time. Setting this to more than 1 will
  ensure that reddit's ratelimit is never reached, but it will make things run slower than necessary if only a few requests
  are being sent. If this is set to zero, snoowrap will not enforce any delay between individual requests. However, it will
  still refuse to continue if reddit's enforced ratelimit (600 requests per 10 minutes) is exceeded.
  * @param {string} [options.continue_after_ratelimit_error=false] Determines whether snoowrap should queue API calls if
  reddit's ratelimit is exceeded. If set to `true` when the ratelimit is exceeded, snoowrap will queue all further requests,
  and will attempt to send them again after the current ratelimit period expires (which happens every 10 minutes). If set
  to `false`, snoowrap will simply throw an error when reddit's ratelimit is exceeded.
  * @param {Number[]} [options.retry_error_codes=[502, 503, 504, 522]] If reddit responds to a request with one of these error
  codes, snoowrap will retry the request, up to a maximum of `options.max_retry_attempts` requests in total. (These errors
  usually indicate that there was an temporary issue on reddit's end, and retrying the request has a decent chance of
  success.) This behavior can be disabled by simply setting this property to an empty array.
  * @param {number} [options.max_retry_attempts=3] See `retry_error_codes`.
  * @param {boolean} [options.suppress_warnings=false] snoowrap may occasionally log relevant warnings, such as deprecation
  notices, to the console. These can be disabled by setting this to `true`.
  * @returns {object} An updated Object containing all of the configuration values
  */
  config (options) {
    return _.assign(this._config, options);
  }
  _revoke_token (token) {
    return request_handler.base_client_request(this, 'post', [{uri: 'api/v1/revoke_token', form: {token}}]);
  }
  /**
  * @summary Invalidates the current access token.
  * @returns {Promise} A Promise that fulfills when this request is complete
  * @desc **Note**: This can only be used if the current requester was supplied with a `client_id` and `client_secret`. If the
  current requester was supplied with a refresh token, it will automatically create a new access token if any more requests
  are made after this one.
  */
  revoke_access_token () {
    return this._revoke_token(this.access_token).then(() => {
      this.access_token = undefined;
    });
  }
  /**
  * @summary Invalidates the current refresh token.
  * @returns {Promise} A Promise that fulfills when this request is complete
  * @desc **Note**: This can only be used if the current requester was supplied with a `client_id` and `client_secret`. All
  access tokens generated by this refresh token will also be invalidated. This effectively de-authenticates the requester and
  prevents it from making any more valid requests. This should only be used in a few cases, e.g. if this token has
  been accidentally leaked to a third party.
  */
  revoke_refresh_token () {
    return this._revoke_token(this.refresh_token).then(() => {
      this.refresh_token = undefined;
      this.access_token = undefined; // Revoking a refresh token also revokes any associated access tokens.
    });
  }
  inspect () {
    // Hide confidential information (tokens, client IDs, etc.), as well as private properties, from the console.log output.
    const keys_for_hidden_values = ['client_secret', 'refresh_token', 'access_token'];
    const formatted = _(this).omitBy((value, key) => key.startsWith('_')).mapValues((value, key) => {
      if (_.includes(keys_for_hidden_values, key)) {
        return value && '(redacted)';
      }
      return value;
    }).value();
    return `${constants.MODULE_NAME} ${require('util').inspect(formatted)}`;
  }
  warn (...args) {
    if (!this._config.suppress_warnings) {
      console.warn(...args);
    }
  }
  /**
  * @summary Gets information on the requester's own user profile.
  * @returns {RedditUser} A RedditUser object corresponding to the requester's profile
  */
  get_me () {
    return promise_wrap(this._get('api/v1/me').then(result => {
      this.own_user_info = this._new_object('RedditUser', result, true);
      return this.own_user_info;
    }));
  }
  _get_my_name () {
    return Promise.resolve(this.own_user_info ? this.own_user_info.name : this.get_me().get('name'));
  }
  /**
  * @summary Gets information on a reddit user with a given name.
  * @param {string} name - The user's username
  * @returns {RedditUser} An unfetched RedditUser object for the requested user
  */
  get_user (name) {
    return this._new_object('RedditUser', {name});
  }
  /**
  * @summary Gets information on a comment with a given id.
  * @param {string} comment_id - The base36 id of the comment
  * @returns {Comment} An unfetched Comment object for the requested comment
  */
  get_comment (comment_id) {
    return this._new_object('Comment', {name: `t1_${comment_id}`});
  }
  /**
  * @summary Gets information on a given subreddit.
  * @param {string} display_name - The name of the subreddit (e.g. 'AskReddit')
  * @returns {Subreddit} An unfetched Subreddit object for the requested subreddit
  */
  get_subreddit (display_name) {
    return this._new_object('Subreddit', {display_name});
  }
  /**
  * @summary Gets information on a given submission.
  * @param {string} submission_id - The base36 id of the submission
  * @returns {Submission} An unfetched Submission object for the requested submission
  */
  get_submission (submission_id) {
    return this._new_object('Submission', {name: `t3_${submission_id}`});
  }
  /**
  * @summary Gets a private message by ID.
  * @param {string} message_id The base36 ID of the message
  * @returns {PrivateMessage} An unfetched PrivateMessage object for the requested message
  */
  get_message (message_id) {
    return this._new_object('PrivateMessage', {name: `t4_${message_id}`});
  }
  /**
  * Gets a livethread by ID.
  * @param {string} thread_id The base36 ID of the livethread
  * @returns {LiveThread} An unfetched LiveThread object
  */
  get_livethread (thread_id) {
    return this._new_object('LiveThread', {id: thread_id});
  }
  /**
  * @summary Gets a distribution of the requester's own karma distribution by subreddit.
  * @returns {Promise} A Promise for an object with karma information
  */
  get_karma () {
    return this._get({uri: 'api/v1/me/karma'});
  }
  /**
  * @summary Gets information on the user's current preferences.
  * @returns {Promise} A promise for an object containing the user's current preferences
  */
  get_preferences () {
    return this._get({uri: 'api/v1/me/prefs'});
  }
  /**
  * @summary Updates the user's current preferences.
  * @param {object} updated_preferences An object of the form {[some preference name]: 'some value', ...}. Any preference
  * not included in this object will simply retain its current value.
  * @returns {Promise} A Promise that fulfills when the request is complete
  */
  update_preferences (updated_preferences) {
    return this._patch({uri: 'api/v1/me/prefs', body: updated_preferences});
  }
  /**
  * @summary Gets the currently-authenticated user's trophies.
  * @returns {Promise} A TrophyList containing the user's trophies
  */
  get_my_trophies () {
    return this._get({uri: 'api/v1/me/trophies'});
  }
  /**
  * @summary Gets the list of the currently-authenticated user's friends.
  * @returns {Promise} A Promise that resolves with a list of friends
  */
  get_friends () {
    return this._get({uri: 'prefs/friends'});
  }
  /**
  * @summary Gets the list of people that the currently-authenticated user has blocked.
  * @returns {Promise} A Promise that resolves with a list of blocked users
  */
  get_blocked_users () {
    return this._get({uri: 'prefs/blocked'});
  }
  /**
  * @summary Determines whether the currently-authenticated user needs to fill out a captcha in order to submit content.
  * @returns {Promise} A Promise that resolves with a boolean value
  */
  check_captcha_requirement () {
    return this._get({uri: 'api/needs_captcha'});
  }
  /**
  * @summary Gets the identifier (a hex string) for a new captcha image.
  * @returns {Promise} A Promise that resolves with a string
  */
  get_new_captcha_identifier () {
    return promise_wrap(this._post({uri: 'api/new_captcha', form: {api_type}}).then(res => res.json.data.iden));
  }
  /**
  * @summary Gets an image for a given captcha identifier.
  * @param {string} identifier The captcha identifier.
  * @returns {Promise} A string containing raw image data in PNG format
  */
  get_captcha_image (identifier) {
    return this._get({uri: `captcha/${identifier}`});
  }
  /**
  * @summary Gets an array of categories that items can be saved in. (Requires reddit gold)
  * @returns {Promise} An array of categories
  */
  get_saved_categories () {
    return this._get({uri: 'api/saved_categories'}).get('categories');
  }
  /**
  * @summary Marks a list of submissions as 'visited'.
  * @param {Submission[]} links A list of Submission objects to mark
  * @returns {Promise} A Promise that fulfills when the request is complete
  */
  mark_as_visited (links) {
    return this._post({uri: 'api/store_visits', links: _.map(links, 'name').join(',')});
  }
  _submit ({captcha_response, captcha_iden, kind, resubmit = true, send_replies = true, text, title, url, subreddit_name}) {
    return promise_wrap(this._post({uri: 'api/submit', form: {
      api_type, captcha: captcha_response, iden: captcha_iden, sendreplies: send_replies, sr: subreddit_name, kind, resubmit,
      text, title, url
    }}).tap(helpers._handle_json_errors).then(result => this.get_submission(result.json.data.id)));
  }
  /**
  * @summary Creates a new selfpost on the given subreddit.
  * @param {object} options An object containing details about the submission
  * @param {string} options.subreddit_name The name of the subreddit that the post should be submitted to
  * @param {string} options.title The title of the submission
  * @param {string} [options.text] The selftext of the submission
  * @param {boolean} [options.send_replies=true] Determines whether inbox replies should be enabled for this submission
  * @param {string} [options.captcha_iden] A captcha identifier. This is only necessary if the authenticated account
  requires a captcha to submit posts and comments.
  * @param {string} [options.captcha_response] The response to the captcha with the given identifier
  * @returns {Promise} The newly-created Submission object
  */
  submit_selfpost (options) {
    return this._submit(_.assign(options, {kind: 'self'}));
  }
  /**
  * @summary Creates a new link submission on the given subreddit.
  * @param {object} options An object containing details about the submission
  * @param {string} options.subreddit_name The name of the subreddit that the post should be submitted to
  * @param {string} options.title The title of the submission
  * @param {string} options.url The url that the link submission should point to
  * @param {boolean} [options.send_replies=true] Determines whether inbox replies should be enabled for this submission
  * @param {boolean} [options.resubmit=true] If this is false and same link has already been submitted to this subreddit in
  the past, reddit will return an error. This could be used to avoid accidental reposts.
  * @param {string} [options.captcha_iden] A captcha identifier. This is only necessary if the authenticated account
  requires a captcha to submit posts and comments.
  * @param {string} [options.captcha_response] The response to the captcha with the given identifier
  * @returns {Promise} The newly-created Submission object
  */
  submit_link (options) {
    return this._submit(_.assign(options, {kind: 'link'}));
  }
  _get_sorted_frontpage (sort_type, subreddit_name, options = {}) {
    // Handle things properly if only a time parameter is provided but not the subreddit name
    let opts = options;
    let sub_name = subreddit_name;
    if (typeof subreddit_name === 'object' && _(opts).omitBy(_.isUndefined).isEmpty()) {
      /* In this case, "subreddit_name" ends up referring to the second argument, which is not actually a name since the user
      decided to omit that parameter. */
      opts = subreddit_name;
      sub_name = undefined;
    }
    const parsed_options = _(opts).assign({t: opts.time, time: undefined}).omit('time').value();
    return this._get({uri: (sub_name ? `r/${sub_name}/` : '') + sort_type, qs: parsed_options});
  }
  /**
  * @summary Gets a Listing of hot posts.
  * @param {string} [subreddit_name] The subreddit to get posts from. If not provided, posts are fetched from
  the front page of reddit.
  * @param {object} [options={}] Options for the resulting Listing
  * @returns {Promise} A Listing containing the retrieved submissions
  */
  get_hot (subreddit_name, options) {
    return this._get_sorted_frontpage('hot', subreddit_name, options);
  }
  /**
  * @summary Gets a Listing of new posts.
  * @param {string} [subreddit_name] The subreddit to get posts from. If not provided, posts are fetched from
  the front page of reddit.
  * @param {object} [options={}] Options for the resulting Listing
  * @returns {Promise} A Listing containing the retrieved submissions
  */
  get_new (subreddit_name, options) {
    return this._get_sorted_frontpage('new', subreddit_name, options);
  }
  /**
  * @summary Gets a Listing of new comments.
  * @param {string} [subreddit_name] The subreddit to get comments from. If not provided, posts are fetched from
  the front page of reddit.
  * @param {object} [options={}] Options for the resulting Listing
  * @returns {Promise} A Listing containing the retrieved comments
  */
  get_new_comments (subreddit_name, options) {
    return this._get_sorted_frontpage('comments', subreddit_name, options);
  }
  /**
  * @summary Gets a single random Submission.
  * @param {string} [subreddit_name] The subreddit to get the random submission. If not provided, the post is fetched from
  the front page of reddit.
  * @returns {Promise} The retrieved Submission object
  */
  get_random_submission (subreddit_name) {
    return this._get_sorted_frontpage('random', subreddit_name);
  }
  /**
  * @summary Gets a Listing of top posts.
  * @param {string} [subreddit_name] The subreddit to get posts from. If not provided, posts are fetched from
  the front page of reddit.
  * @param {object} [options={}]
  * @param {string} [options.time] Describes the timespan that posts should be retrieved from. Should be one of
  `hour, day, week, month, year, all`
  * @returns {Promise} A Listing containing the retrieved submissions
  */
  get_top (subreddit_name, options = {}) {
    return this._get_sorted_frontpage('top', subreddit_name, {time: options.time});
  }
  /**
  * @summary Gets a Listing of controversial posts.
  * @param {string} [subreddit_name] The subreddit to get posts from. If not provided, posts are fetched from
  the front page of reddit.
  * @param {object} [options={}]
  * @param {string} [options.time] Describes the timespan that posts should be retrieved from. Should be one of
  `hour, day, week, month, year, all`
  * @returns {Promise} A Listing containing the retrieved submissions
  */
  get_controversial (subreddit_name, options) {
    return this._get_sorted_frontpage('controversial', subreddit_name, {time: options.time});
  }
  async _select_flair ({flair_template_id, link, name, text, subreddit_name}) {
    if (!flair_template_id) {
      throw new errors.InvalidMethodCallError('Error: No flair template ID provided');
    }
    return await this._post({uri: `r/${await subreddit_name}/api/selectflair`, form: {
      api_type, flair_template_id, link, name, text}
    });
  }
  async _assign_flair ({css_class, link, name, text, subreddit_name}) {
    return await this._post({uri: `r/${await subreddit_name}/api/flair`, form: {api_type, name, text, link, css_class}});
  }
  /**
  * @summary Gets the authenticated user's unread messages.
  * @param {object} options
  * @returns {Promise} A Listing containing unread items in the user's inbox
  */
  get_unread_messages (options = {}) {
    return this._get({uri: 'message/unread', qs: options});
  }
  /**
  * @summary Gets the items in the authenticated user's inbox.
  * @param {object} options
  * @returns {Promise} A Listing containing items in the user's inbox
  */
  get_inbox (options = {}) {
    return this._get({uri: 'message/inbox', qs: options});
  }
  /**
  * @summary Gets the authenticated user's modmail.
  * @param {object} options
  * @returns {Promise} A Listing of the user's modmail
  */
  get_modmail (options = {}) {
    return this._get({uri: 'message/moderator', qs: options});
  }
  /**
  * @summary Gets the user's sent messages.
  * @param {object} [options={}] options for the resulting Listing
  * @returns {Promise} A Listing of the user's sent messages
  */
  get_sent_messages (options = {}) {
    return this._get({uri: 'message/sent', qs: options});
  }
  /**
  * @summary Marks all of the user's messages as read.
  * @returns {Promise} A Promise that resolves when the request is complete
  */
  read_all_messages () {
    return this._post({uri: 'api/read_all_messages'});
  }
  /**
  * @summary Composes a new private message.
  * @param {object} $0
  * @param {RedditUser|Subreddit|string} $0.to The recipient of the message.
  * @param {string} $0.subject The message subject (100 characters max)
  * @param {string} $0.text The body of the message, in raw markdown text_edit
  * @param {Subreddit|string} [$0.from_subreddit] If provided, the message is sent as a modmail from the specified subreddit.
  * @param {string} [$0.captcha_iden] A captcha identifier. This is only necessary if the authenticated account
  requires a captcha to submit posts and comments.
  * @param {string} [$0.captcha_response] The response to the captcha with the given identifier
  * @returns {Promise} A Promise that fulfills when the request is complete
  */
  compose_message ({captcha, from_subreddit, captcha_iden, subject, text, to}) {
    let parsed_to = to;
    let parsed_from_sr = from_subreddit;
    if (to instanceof snoowrap.objects.RedditUser) {
      parsed_to = to.name;
    } else if (to instanceof snoowrap.objects.Subreddit) {
      parsed_to = `/r/${to.display_name}`;
    }
    if (from_subreddit instanceof snoowrap.objects.Subreddit) {
      parsed_from_sr = from_subreddit.display_name;
    } else if (typeof from_subreddit === 'string') {
      parsed_from_sr = from_subreddit.replace(/^\/?r\//, ''); // Convert '/r/subreddit_name' to 'subreddit_name'
    }
    return this._post({uri: 'api/compose', form: {
      api_type, captcha, iden: captcha_iden, from_sr: parsed_from_sr, subject, text, to: parsed_to
    }});
  }
  /**
  * @summary Gets a list of all oauth scopes supported by the reddit API.
  * @returns {Promise} An object containing oauth scopes.
  * @desc **Note**: To get the scope of this requester, use the `scope` property instead.
  */
  get_oauth_scope_list () {
    return promise_wrap(this._get({uri: 'api/v1/scopes'}));
  }
  /**
  * @summary Conducts a search of reddit submissions.
  * @param {object} options Search options. Can also contain options for the resulting Listing.
  * @param {string} options.query The search query
  * @param {string} [options.time] Describes the timespan that posts should be retrieved frome. One of
  `hour, day, week, month, year, all`
  * @param {Subreddit|string} [options.subreddit] The subreddit to conduct the search on.
  * @param {boolean} [options.restrict_sr=true] Restricts search results to the given subreddit
  * @param {string} [options.sort] Determines how the results should be sorted. One of `relevance, hot, top, new, comments`
  * @param {string} [options.syntax='plain'] Specifies a syntax for the search. One of `cloudsearch, lucene, plain`
  * @returns {Promise} A Listing containing the search results.
  */
  search (options) {
    if (options.subreddit instanceof snoowrap.objects.Subreddit) {
      options.subreddit = options.subreddit.display_name;
    }
    const parsed_query = _(options).assign({t: options.time, q: options.query}).omit('time', 'query').value();
    return this._get({uri: `${options.subreddit ? `r/${options.subreddit}/` : ''}search`, qs: parsed_query});
  }
  /**
  * @summary Searches for subreddits given a query.
  * @param {object} $0
  * @param {string} $0.query A search query (50 characters max)
  * @param {boolean} [$0.exact=false] Determines whether the results shouldbe limited to exact matches.
  * @param {boolean} [$0.include_nsfw=true] Determines whether the results should include NSFW subreddits.
  * @returns {Promise} An Array containing subreddit names
  */
  search_subreddit_names ({exact = false, include_nsfw = true, query}) {
    return this._post({uri: 'api/search_reddit_names', qs: {exact, include_over_18: include_nsfw, query}}).names;
  }
  _create_or_edit_subreddit ({
    allow_top = true,
    captcha,
    captcha_iden,
    collapse_deleted_comments = false,
    comment_score_hide_mins = 0,
    description,
    exclude_banned_modqueue = false,
    'header-title': header_title,
    hide_ads = false,
    lang = 'en',
    link_type = 'any',
    name,
    over_18 = false,
    public_description,
    public_traffic = false,
    show_media = false,
    spam_comments = 'high',
    spam_links = 'high',
    spam_selfposts = 'high',
    sr,
    submit_link_label = '',
    submit_text_label = '',
    submit_text = '',
    suggested_comment_sort = 'confidence',
    title,
    type = 'public',
    subreddit_type, // This is the same as `type`, but for some reason the name is changed when fetching current settings
    wiki_edit_age,
    wiki_edit_karma,
    wikimode = 'modonly'
  }) {
    return promise_wrap(this._post({uri: 'api/site_admin', form: {
      allow_top, api_type, captcha, collapse_deleted_comments, comment_score_hide_mins, description, exclude_banned_modqueue,
      'header-title': header_title, hide_ads, iden: captcha_iden, lang, link_type, name, over_18, public_description,
      public_traffic, show_media, spam_comments, spam_links, spam_selfposts, sr, submit_link_label, submit_text,
      submit_text_label, suggested_comment_sort, title, type: subreddit_type || type, wiki_edit_age, wiki_edit_karma, wikimode
    }}).bind(this.get_subreddit(name)).then(helpers._handle_json_errors));
  }
  /**
  * @summary Creates a new subreddit.
  * @param {object} options
  * @param {string} options.name The name of the new subreddit
  * @param {string} options.title The text that should appear in the header of the subreddit
  * @param {string} options.public_description The text that appears with this subreddit on the search page, or on the
  blocked-access page if this subreddit is private. (500 characters max)
  * @param {string} options.description The sidebar text for the subreddit. (5120 characters max)
  * @param {string} [options.submit_text=''] The text to show below the submission page (1024 characters max)
  * @param {boolean} [options.hide_ads=false] Determines whether ads should be hidden on this subreddit. (This is only
  allowed for gold-only subreddits.)
  * @param {string} [options.lang='en'] The language of the subreddit (represented as an IETF language tag)
  * @param {string} [options.type='public'] Determines who should be able to access the subreddit. This should be one of
  `public, private, restricted, gold_restricted, gold_only, archived, employees_only`.
  * @param {string} [options.link_type='any'] Determines what types of submissions are allowed on the subreddit. This should
  be one of `any, link, self`.
  * @param {string} [options.submit_link_label=undefined] Custom text to display on the button that submits a link. If
  this is omitted, the default text will be displayed.
  * @param {string} [options.submit_text_label=undefined] Custom text to display on the button that submits a selfpost. If
  this is omitted, the default text will be displayed.
  * @param {string} [options.wikimode='modonly'] Determines who can edit wiki pages on the subreddit. This should be one of
  `modonly, anyone, disabled`.
  * @param {number} [options.wiki_edit_karma=0] The minimum amount of subreddit karma needed for someone to edit this
  subreddit's wiki. (This is only relevant if `options.wikimode` is set to `anyone`.)
  * @param {number} [options.wiki_edit_age=0] The minimum account age (in days) needed for someone to edit this subreddit's
  wiki. (This is only relevant if `options.wikimode` is set to `anyone`.)
  * @param {string} [options.spam_links='high'] The spam filter strength for links on this subreddit. This should be one of
  `low, high, all`.
  * @param {string} [options.spam_selfposts='high'] The spam filter strength for selfposts on this subreddit. This should be
  one of `low, high, all`.
  * @param {string} [options.spam_comments='high'] The spam filter strength for comments on this subreddit. This should be one
  of `low, high, all`.
  * @param {boolean} [options.over_18=false] Determines whether this subreddit should be classified as NSFW
  * @param {boolean} [options.allow_top=true] Determines whether the new subreddit should be able to appear in /r/all and
  trending subreddits
  * @param {boolean} [options.show_media=false] Determines whether image thumbnails should be enabled on this subreddit
  * @param {boolean} [options.exclude_banned_modqueue=false] Determines whether posts by site-wide banned users should be
  excluded from the modqueue.
  * @param {boolean} [options.public_traffic=false] Determines whether the /about/traffic page for this subreddit should be
  viewable by anyone.
  * @param {boolean} [options.collapse_deleted_comments=false] Determines whether deleted and removed comments should be
  collapsed by default
  * @param {string} [options.suggested_comment_sort=undefined] The suggested comment sort for the subreddit. This should be
  one of `confidence, top, new, controversial, old, random, qa`.If left blank, there will be no suggested sort,
  which means that users will see the sort method that is set in their own preferences (usually `confidence`.)
  * @returns {Promise} A Promise for the newly-created subreddit object.
  */
  create_subreddit (options) {
    return this._create_or_edit_subreddit(options);
  }
  /**
  * @summary Searches subreddits by topic.
  * @param {object} $0
  * @param {string} $0.query The search query. (50 characters max)
  * @returns {Promise} An Array of subreddit objects corresponding to the search results
  */
  search_subreddit_topics ({query}) {
    return promise_wrap(this._get({uri: 'api/subreddits_by_topic', qs: {query}}).then(results =>
      _.map(results, 'name').map(this.get_subreddit.bind(this))
    ));
  }
  /**
  * @summary Gets a list of subreddits that the currently-authenticated user is subscribed to.
  * @param {object} [options] Options for the resulting Listing
  * @returns {Promise} A Listing containing Subreddits
  */
  get_subscriptions (options) {
    return this._get({uri: 'subreddits/mine/subscriber', qs: options});
  }
  /**
  * @summary Gets a list of subreddits in which the currently-authenticated user is an approved submitter.
  * @param {object} [options] Options for the resulting Listing
  * @returns {Promise} A Listing containing Subreddits
  */
  get_contributor_subreddits (options) {
    return this._get({uri: 'subreddits/mine/contributor', qs: options});
  }
  /**
  * @summary Gets a list of subreddits in which the currently-authenticated user is a moderator.
  * @param {object} [options] Options for the resulting Listing
  * @returns {Promise} A Listing containing Subreddits
  */
  get_moderated_subreddits (options) {
    return this._get({uri: 'subreddits/mine/moderator', qs: options});
  }
  /**
  * @summary Searches subreddits by title and description.
  * @param {object} options Options for the search. May also contain Listing parameters.
  * @param {string} options.query The search query
  * @returns {Promise} A Listing containing Subreddits
  */
  search_subreddits (options) {
    options.q = options.query;
    return this._get({uri: 'subreddits/search', qs: _.omit(options, 'query')});
  }
  /**
  * @summary Gets a list of subreddits, arranged by popularity.
  * @param {object} [options] Options for the resulting Listing
  * @returns {Promise} A Listing containing Subreddits
  */
  get_popular_subreddits (options) {
    return this._get({uri: 'subreddits/popular', qs: options});
  }
  /**
  * @summary Gets a list of subreddits, arranged by age.
  * @param {object} [options] Options for the resulting Listing
  * @returns {Promise} A Listing containing Subreddits
  */
  get_new_subreddits (options) {
    return this._get({uri: 'subreddits/new', qs: options});
  }
  /**
  * @summary Gets a list of gold-exclusive subreddits.
  * @param {object} [options] Options for the resulting Listing
  * @returns {Promise} A Listing containing Subreddits
  */
  get_gold_subreddits (options) {
    return this._get({uri: 'subreddits/gold', qs: options});
  }
  /**
  * @summary Gets a list of default subreddits.
  * @param {object} [options] Options for the resulting Listing
  * @returns {Promise} A Listing containing Subreddits
  */
  get_default_subreddits (options) {
    return this._get({uri: 'subreddits/default', qs: options});
  }
  _friend (options) {
    return this._post({uri: `${options.sub ? `r/${options.sub}/` : ''}api/friend`, form: _.assign(options, {api_type})});
  }
  _unfriend (options) {
    return this._post({uri: `${options.sub ? `r/${options.sub}/` : ''}api/unfriend`, form: _.assign(options, {api_type})});
  }
  /**
  * @summary Checks whether a given username is available for registration
  * @param {string} name The username in question
  * @returns {Promise} A Promise that fulfills with a Boolean (`true` or `false`)
  */
  check_username_availability (name) {
    // The oauth endpoint listed in reddit's documentation doesn't actually work, so just send an unauthenticated request.
    return request_handler.unauthenticated_request(this, 'get', [{
      uri: 'api/username_available.json',
      qs: {user: name}
    }]);
  }
  /**
  * @summary Creates a new LiveThread.
  * @param {object} $0
  * @param {string} $0.title The title of the livethread (100 characters max)
  * @param {string} [$0.description] A descriptions of the thread. 120 characters max
  * @param {string} [$0.resources] Information and useful links related to the thread. 120 characters max
  * @param {boolean} [$0.nsfw=false] Determines whether the thread is Not Safe For Work
  * @returns {Promise} A Promise that fulfills with the new LiveThread when the request is complete
  */
  create_livethread ({title, description, resources, nsfw = false}) {
    return promise_wrap(this._post({
      uri: 'api/live/create',
      form: {api_type, description, nsfw, resources, title}
    }).tap(helpers._handle_json_errors).then(result => this.get_livethread(result.json.data.id)));
  }
  /**
  * @summary Gets the user's own multireddits.
  * @returns {Promise} A Promise for an Array containing the requester's MultiReddits.
  */
  get_my_multireddits () {
    return this._get({uri: 'api/multi/mine', qs: {expand_srs: true}});
  }
  /**
  * @summary Creates a new multireddit.
  * @param {object} $0
  * @param {string} $0.name The name of the new multireddit. 50 characters max
  * @param {string} $0.description A description for the new multireddit, in markdown.
  * @param {Array} $0.subreddits An Array of Subreddit objects (or subreddit names) that this multireddit should compose of.
  * @param {string} [$0.visibility='private'] The multireddit's visibility setting. One of `private`, `public`, `hidden`.
  * @param {string} [$0.icon_name=''] One of `'art and design'`, `ask`, `books`, `business`, `cars`, `comics`, `cute animals`,
  `diy`, `entertainment`, `food and drink`, `funny`, `games`, `grooming`, `health`, `life advice`, `military`, `models pinup`,
  `music`, `news`, `philosophy`, `pictures and gifs`, `science`, `shopping`, `sports`, `style`, `tech`, `travel`,
  `unusual stories`, `video`, `None`
  * @param {string} [$0.key_color='#000000'] A six-digit RGB hex color, preceded by '#'
  * @param {string} [$0.weighting_scheme='classic'] One of 'classic', 'fresh'
  * @returns {Promise} A Promise for the newly-created MultiReddit object
  */
  create_multireddit ({name, description, subreddits, visibility = 'private', icon_name = '', key_color = '#000000',
      weighting_scheme = 'classic'}) {
    return this._post({uri: 'api/multi', form: {model: JSON.stringify({
      display_name: name,
      description_md: description,
      icon_name,
      key_color,
      subreddits: subreddits.map(sub => ({name: _.isString(sub) ? sub : sub.display_name})),
      visibility,
      weighting_scheme
    })}});
  }
};

_.forEach(constants.HTTP_VERBS, type => {
  snoowrap.prototype[`_${type}`] = function (...args) {
    return promise_wrap(request_handler.oauth_request(this, type, args));
  };
});

snoowrap.objects = require('./objects');

_.forOwn(constants.KINDS, value => {
  snoowrap.objects[value] = snoowrap.objects[value] || class extends snoowrap.objects.RedditContent {};
});

_.forOwn(snoowrap.objects, (value, key) => {
  /* This is used to allow `objects.something = class {}` as opposed to `objects.something = class something {}`. The
  alternative sets the class name properly under normal circumstances, but it causes issues when the code gets minifified,
  since the class name changes. */
  Object.defineProperty(value, 'name', {get: _.constant(key)});
});

snoowrap.helpers = helpers;
snoowrap.errors = errors;
module.exports = snoowrap;
