$(function() {
  var originalButton = $('.draft-show-original'),
      viewingOriginal = false;

  if (location.search.indexOf('show_original=1') != -1) {
    $('.apos-area-controls').hide();
    originalButton.text('Show Pending Edits');
    viewingOriginal = true;
  }

  $('body').on('click', '.drafts-list-button', function() {
    var $el = apos.modalFromTemplate('.drafts-list-page', {
      init: function(callback) {
        $drafts = $el.find('table.drafts-table tbody');

        $el.on('click', '.sort', function() {
          var sort = $(this).data('sort');
          var order = $(this).data('order') || 'asc';
          $.get('/draft-pages/list-drafts?sort='+sort+'&order='+order, {}, function(data) {
            $drafts.html(data);
          });
          $(this).data('order', order == 'asc' ? 'desc' : 'asc');
        });

        $el.on('click', '.commit-selected', function() {
          if (!confirm("Are you sure you want to commit the selected changes?")) {
            return false;
          }
          var selectedIds = $drafts.find('input:checked').map(function() {
            return $(this).val();
          }).get();

          $.post('/draft-pages/commit', { page_ids: selectedIds }, function(data) {
            alert('Committed changes on ' + selectedIds.length + ' pages.');
            $drafts.find('input:checked').closest('tr').remove();
          });
        });

        $el.on('click', '.revert-selected', function() {
          if (!confirm("Are you sure you want to revert the selected changes?")) {
            return false;
          }
          var selectedIds = $drafts.find('input:checked').map(function() {
            return $(this).val();
          }).get();

          $.post('/draft-pages/revert', { page_ids: selectedIds }, function(data) {
            alert('Reverted changes on ' + selectedIds.length + ' pages.');
            $drafts.find('input:checked').closest('tr').remove();
          });
        });

        $.get('/draft-pages/list-drafts', {}, function(data) {
          $drafts.html(data);
        });
        return callback();
      }
    });
  });


  originalButton.on('click', function() {
    var url = window.location.href.replace(/#.*$/, ''),
        origString = 'show_original=1',
        start = url.indexOf(origString),
        end = start + origString.length;

    if (viewingOriginal) {
      if (end == url.length) {
        start = start - 1;
      } else {
        end = end + 1;
      }
      window.location = url.slice(0,start) + url.slice(end);
    } else {
      window.location = url + (url.indexOf('?') != -1 ? '&' : '?') + origString;
    }
    return false;
  });


  $('body').on('click', '.draft-revert', function() {
    if (!confirm("Are you sure you want to revert the pending changes on this page?")) {
      return false;
    }

    var page_id = $(this).data('page-id');
    $.ajax(
      {
        url: '/draft-pages/revert',
        data: {
          page_id: page_id
        },
        type: 'POST',
        dataType: 'json',
        success: function(data) {
          location.reload();
        },
        error: function() {
          alert('Server error');
        }
      }
    );
    return false;
  });

  $('body').on('click', '.draft-commit', function() {
    if (!confirm("Are you sure you want to commit the pending changes on this page?")) {
      return false;
    }

    var page_id = $(this).data('page-id');
    $.ajax(
      {
        url: '/draft-pages/commit',
        data: {
          page_id: page_id
        },
        type: 'POST',
        dataType: 'json',
        success: function(data) {
          location.reload();
        },
        error: function() {
          alert('Server error');
        }
      }
    );
    return false;
  });
});