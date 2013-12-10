var async = require('async');
var _ = require('underscore');
var extend = require('extend');

module.exports = function(options, callback) {
  return new draftPagesModule(options, callback); // must return the "module" object, even if it's an empty object
};

var app, apos, skipVersioning;

draftPagesModule = function(options, callback) {
  app = options.app;
  apos = options.apos;
  skipVersioning = false;

  extendPrunePage(options.pages);
  extendPutArea();
  extendGet();
  misc();
  addRoutes();

  pushAsset('template', 'modal');

  if (callback) {
    process.nextTick(function() { return callback(null); });
  }
};

function extendPrunePage(pages) {
  var superPrunePage = pages.prunePage;
  pages.prunePage = function(page) {
    return superPrunePage(_.omit(page, 'draftareas'));
  };
}

function pushAsset(type, name, optionsArg) {
    var options = {};
    if (optionsArg) {
      extend(true, options, optionsArg);
    }
    options.fs = __dirname;
    options.web = '/draft-pages';
    return apos.pushAsset(type, name, options);
  };

function misc() {
  var superVersionPage = apos.versionPage;
  apos.versionPage = function(req, pageOrSlug, callback) {
    if (skipVersioning) {
      return callback(null);
    }
    return superVersionPage(req, pageOrSlug, callback);
  };

  apos.addLocal('draftPagesMenu', function(options) {
    return apos.partial('draftPagesMenu', { args: options }, __dirname + '/views');
  });
}



function addRoutes() {
  app.get('/draft-pages/list-drafts', function(req, res) {
    var criteria = {
      draftareas: {
        $exists: true,
        $nin: [null, {}]
      }
    };

    var sort,
        order = req.query.order == 'asc' ? 1 : -1;
    if (req.query.sort === 'time') {
      sort = { lastEditTime: order };
    } else if (req.query.sort == 'author') {
      sort = { lastEditAuthor: order };
    }

    apos.get(req, { }, { lateCriteria: criteria, sort: sort }, function(err, results) {
      if (err) {
        res.statusCode = 500;
        return res.send({error: err});
      } else {
        return res.send(apos.partial('draftsList', { pages: results.pages }, __dirname+'/views'));
      }
    });
  });

  app.post('/draft-pages/revert', function(req, res) {
    var pageIds = req.body.page_id ? [req.body.page_id] : req.body.page_ids;
    var pages = [];

    function findPages(callback) {
      return apos.pages.find({ _id: { $in: pageIds }}, function(err, cursor) {
        cursor.toArray(function(err, items) {
          pages = items;
          return callback(err);
        });
      });
    }

    function permissions(callback) {
      return async.each(pages, function(page, cb) {
        return apos.permissions(req, 'edit-page', page, cb);
      }, callback);
    }

    function revert(callback) {
      skipVersioning = true;
      return async.each(pages, function(page, cb) {
        delete page.draftareas;
        return apos.putPage(req, page.slug, page, cb);
      }, callback);
    }

    function ready(err) {
      skipVersioning = false;
      if (err) {
        res.statusCode = 500;
        return res.send({error: err});
      } else {
        return res.send({success: true});
      }
    }

    async.series([findPages, permissions, revert], ready);
  });

  app.post('/draft-pages/commit', function(req, res) {
    var pageIds = req.body.page_id ? [req.body.page_id] : req.body.page_ids;
    var pages = [];

    function findPages(callback) {
      return apos.pages.find({ _id: { $in: pageIds }}, function(err, cursor) {
        cursor.toArray(function(err, items) {
          pages = items;
          return callback(err);
        });
      });
    }

    function permissions(callback) {
      return async.each(pages, function(page, cb) {
        return apos.permissions(req, 'admin', page, cb);
      }, callback);
    }

    function commit(callback) {
      return async.each(pages, function(page, cb) {
        page.areas = extend(true, page.areas, page.draftareas);
        delete page.draftareas;
        return apos.putPage(req, page.slug, page, cb);
      }, callback);
    }

    function ready(err) {
      if (err) {
        res.statusCode = 500;
        return res.send({error: err});
      } else {
        return res.send({success: true});
      }
    }

    async.series([findPages, permissions, commit], ready);
  });
}



function extendPutArea() {
  var superPutArea = apos.putArea;
  apos.putArea = function(req, slug, area, callback) {
    if (slug.charAt(0) != '/') {
      return superPutArea(req, slug, area, callback); // only do this for real pages
    }

    var pageOrSlug;

    var matches = slug.match(/^(.*?)\:(\w+)$/);
    if (!matches) {
      return callback('Area slugs now must be page-based: page-slug:areaname');
    }
    var pageSlug = matches[1];
    var areaSlug = matches[2];

    // To check the permissions properly we're best off just getting the page
    // as the user, however we can specify that we don't need the properties
    // returned to speed that up
    function permissions(callback) {
      return apos.get(req, { slug: pageSlug }, { editable: true, fields: { _id: 1 } }, function(err, results) {
        if (err) {
          return callback(err);
        }
        if (!results.pages.length) {
          // If it REALLY doesn't exist, but we have the edit-page permission,
          // and the slug has no leading /, we are allowed to create it.

          // If it is a tree page it must be created via putPage
          if (pageSlug.substr(0, 1) === '/') {
            return callback('notfound');
          }

          // Otherwise it is OK to create it provided it truly does
          // not exist yet. Check MongoDB to distinguish between not
          // finding it due to permissions and not finding it
          // due to nonexistence
          return apos.pages.findOne({ slug: pageSlug }, { _id: 1 }, function(err, page) {
            if (err) {
              return callback(err);
            }
            if (!page) {
              // OK, it's really new
              return callback(null);
            }
            // OK if we have permission to create pages
            return apos.permissions(req, 'edit-page', null, callback);
          });
        }
        return callback(null);
      });
    }

    function update(callback) {
      area.slug = slug;
      var set = {};
      set.slug = pageSlug;
      // Use MongoDB's dot notation to update just the area in question
      set['draftareas.' + areaSlug] = area;
      set.lastEditAuthor = req.user;
      set.lastEditTime = new Date();
      apos.pages.update(
        { slug: pageSlug },
        { $set: set },
        { safe: true },
        function(err, count) {
          if ((!err) && (count === 0)) {
            // The page doesn't exist yet. We'll need to create it. Use
            // an insert without retry, so we fail politely if someone else creates
            // it first or it already existed and mongo just didn't find it somehow.
            // This tactic only makes sense for typeless virtual pages, like the
            // 'global' page often used to hold footers. Other virtual pages should
            // be created before they are used so they have the right type.
            var page = {
              id: apos.generateId(),
              slug: pageSlug,
              draftareas: {},
              lastEditAuthor: req.user,
              lastEditTime: new Date()
            };
            page.draftareas[areaSlug] = area;
            return apos.pages.insert(page, { safe: true }, function(err, page) {
              if (err) {
                return callback(err);
              }
              pageOrSlug = page;
              return callback(null);
            });
          }
          if (err) {
            return callback(err);
          }
          pageOrSlug = pageSlug;
          return callback(null);
        }
      );
    }

    // We've updated or inserted a page, now save a copy in the versions collection.
    // We might already have a page object or, if we did an update, we might have
    // to go fetch it
    function versioning(callback) {
      return apos.versionPage(req, pageOrSlug, callback);
    }

    function indexing(callback) {
      return apos.indexPage(req, pageOrSlug, callback);
    }

    function finish(err) {
      return callback(err, area);
    }

    async.series([permissions, update, versioning, indexing], finish);
  };
}



function extendGet() {
  apos.get = function(req, userCriteria, options, mainCallback) {
    if (arguments.length === 2) {
      mainCallback = userCriteria;
      userCriteria = {};
      options = {};
    } else if (arguments.length === 3) {
      mainCallback = options;
      options = {};
    }

    // Second criteria object based on our processing of `options`
    var filterCriteria = {};

    var editable = options.editable;

    var sort = options.sort;
    // Allow sort to be explicitly false. Otherwise there is no way
    // to get the sorting behavior of the "near" option
    if (sort === undefined) {
      sort = { sortTitle: 1 };
    }

    var limit = options.limit || undefined;

    var skip = options.skip || undefined;

    var fields = options.fields || undefined;

    var titleSearch = options.titleSearch || undefined;

    var areas = options.areas || true;

    var tags = options.tags || undefined;
    var notTags = options.notTags || undefined;

    var permissions = (options.permissions === false) ? false : true;

    var lateCriteria = options.lateCriteria || undefined;

    if (options.titleSearch !== undefined) {
      filterCriteria.sortTitle = apos.searchify(titleSearch);
    }
    apos.convertBooleanFilterCriteria('trash', options, filterCriteria, '0');
    apos.convertBooleanFilterCriteria('orphan', options, filterCriteria, 'any');
    apos.convertBooleanFilterCriteria('published', options, filterCriteria);

    if (tags || notTags) {
      filterCriteria.tags = { };
      if (tags) {
        filterCriteria.tags.$in = tags;
      }
      if (notTags) {
        filterCriteria.tags.$nin = notTags;
      }
    }

    if (options.q && options.q.length) {
      // Crude fulltext search support. It would be better to present
      // highSearchText results before lowSearchText results, but right now
      // we are doing a single query only
      filterCriteria.lowSearchText = apos.searchify(options.q);
    }


    var projection = {};
    extend(true, projection, fields || {});
    if (!areas) {
      projection.areas = 0;
      projection.draftareas = 0;
    } else if (areas === true) {
      // Great, get them all
    } else {
      // We need to initially get them all, then prune them, as
      // MongoDB is not great at fetching specific properties
      // of subdocuments while still fetching everything else
    }

    // get draftareas for each area you get
    for (var key in projection) {
      if (projection.hasOwnProperty(key) && key.slice(0,5) == 'areas') {
        projection['draftareas.' + key.slice(6)] = projection[key];
      }
    }

    var results = {};

    var combine = [ userCriteria, filterCriteria ];

    if (permissions) {
      combine.push(apos.getPermissionsCriteria(req, { editable: editable }));
    }
    var criteria = {
      $and: combine
    };

    // The lateCriteria option is merged with the criteria option last
    // so that it is not subject to any $and clauses, due to this
    // limitation of MongoDB which prevents the highly useful $near
    // clause from being used otherwise:
    //
    // https://jira.mongodb.org/browse/SERVER-4572

    if (lateCriteria) {
      extend(true, criteria, lateCriteria);
    }

    if (options.getDistinct) {
      // Just return distinct values for some field matching the current criteria,
      // rather than the normal results. This is a bit of a hack, we need
      // to consider refactoring all of 'fetchMetadata' here
      return apos.pages.distinct(options.getDistinct, criteria, mainCallback);
    }
    if (options.getDistinctTags) {
      // Just return the distinct tags matching the current criteria,
      // rather than the normal results. This is a bit of a hack, we need
      // to consider refactoring all of 'fetchMetadata' here
      return apos.pages.distinct("tags", criteria, mainCallback);
    }

    async.series([count, loadPages, markPermissions, loadWidgets], done);

    function count(callback) {
      apos.pages.find(criteria).count(function(err, count) {
        results.total = count;
        return callback(err);
      });
    }

    function loadPages(callback) {
      var q = apos.pages.find(criteria, projection);

      // At last we can use skip and limit properly thanks to permissions stored
      // in the document
      if (skip !== undefined) {
        q.skip(skip);
      }
      if (limit !== undefined) {
        q.limit(limit);
      }
      if (sort) {
        q.sort(sort);
      }
      q.toArray(function(err, pagesArg) {
        if (err) {
          console.log(err);
          return callback(err);
        }
        results.pages = pagesArg;

        // Except for ._id, no property beginning with a _ should be
        // loaded from the database. These are reserved for dynamically
        // determined properties like permissions and joins
        _.each(results.pages, function(page) {
          apos.pruneTemporaryProperties(page);
          if (req.user && req.user.permissions && req.user.permissions.edit && page.draftareas && req.query.show_original != 1) {
            page.areas = extend(true, page.areas, page.draftareas);
          }
        });

        if (Array.isArray(areas)) {
          // Prune to specific areas only, alas this can't
          // happen in mongoland as near as I can tell. -Tom
          _.each(results.pages, function(page) {
            if (page.areas) {
              page.areas = _.pick(page.areas, areas);
            }
          });
        }
        return callback(err);
      });
    }

    function markPermissions(callback) {
      apos.addPermissionsToPages(req, results.pages);
      return callback(null);
    }

    function loadWidgets(callback) {
      // Use eachSeries to avoid devoting overwhelming mongodb resources
      // to a single user's request. There could be many snippets on this
      // page, and callLoadersForPage is parallel already
      async.forEachSeries(results.pages, function(page, callback) {
        apos.callLoadersForPage(req, page, callback);
      }, function(err) {
        return callback(err);
      });
    }

    function done(err) {
      return mainCallback(err, results);
    }
  };
}