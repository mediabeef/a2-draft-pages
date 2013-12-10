#a2-draft-pages
________________________________________________

This is v3 of our draft pages plugin for the Apostrophe2 CMS.  



### How To Install

1. Place this folder into node_modules, or place it wherever you'd like and `npm link` it.
2. Add `'draft-pages': { }` to the list of modules that you configure `apostrophe-site` with.
3. Add the menu to the menu bar by adding `{{ draftPagesMenu({ edit: permissions.edit, admin: permissions.admin, page: page }) }}` to the `outerLayout.html file`.



### Questions/Comments:

Media Beef Inc.
mike@mediabeef.com
