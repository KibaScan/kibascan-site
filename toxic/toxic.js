/* Toxic Database pages: the "Share card" button.

   The button is hidden in the HTML, so a page read with scripts off shows only
   the two plain "Save" links, which need no script. Here the button is shown
   and wired up:
     1. the browser can share files  -> share the card image itself;
     2. it can share links only      -> share the page link;
     3. it can do neither            -> copy the page link and say "Link copied".

   A browser opens its share sheet only from inside a tap. Fetching the image
   after the tap can take longer than the tap lasts (Safari then refuses), so
   the image is fetched ahead of time: once the page has loaded and is idle,
   or, for a reader who has asked their browser to save data, when the button
   is first touched or focused. A tap before the image has arrived shares the
   page link instead. Only a browser that can share files fetches the image.

   Nothing is sent anywhere and nothing is stored. */
(function () {
  'use strict';

  var button = document.querySelector('.card-share');
  if (!button) return;
  var status = document.querySelector('.share-status');
  var pageUrl = (document.querySelector('link[rel="canonical"]') || {}).href || location.href;
  var title = button.getAttribute('data-title') || document.title;
  var imageUrl = button.getAttribute('data-image');
  var canShareFiles = !!imageUrl && !!navigator.share && !!navigator.canShare &&
    typeof File === 'function' && typeof fetch === 'function';
  var imageFile = null;
  var asked = false;

  function say(text) {
    if (status) status.textContent = text;
  }

  function cancelled(error) {
    return error && error.name === 'AbortError';
  }

  function prepareImage() {
    if (asked || !canShareFiles) return;
    asked = true;
    fetch(imageUrl)
      .then(function (response) {
        if (!response.ok) throw new Error('image unavailable');
        return response.blob();
      })
      .then(function (blob) {
        var file = new File([blob], imageUrl.split('/').pop(), { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) imageFile = file;
      })
      .catch(function () {
        /* the page link is shared instead */
      });
  }

  function copyLink() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(pageUrl).then(function () {
        say('Link copied');
      });
    }
    return Promise.reject(new Error('no clipboard'));
  }

  function shareLink() {
    if (navigator.share) {
      return navigator.share({ title: title, url: pageUrl });
    }
    return copyLink();
  }

  function share() {
    try {
      if (imageFile) return navigator.share({ files: [imageFile], title: title });
      return shareLink();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  button.hidden = false;
  button.addEventListener('pointerdown', prepareImage);
  button.addEventListener('touchstart', prepareImage);
  button.addEventListener('focus', prepareImage);
  button.addEventListener('click', function () {
    say('');
    share()
      .catch(function (error) {
        if (cancelled(error)) return;
        return copyLink();
      })
      .catch(function (error) {
        if (cancelled(error)) return;
        say('Copy this link: ' + pageUrl);
      });
  });

  var saveData = !!(navigator.connection && navigator.connection.saveData);
  if (canShareFiles && !saveData) {
    var whenIdle = function () {
      (window.requestIdleCallback || function (run) { return setTimeout(run, 1); })(prepareImage);
    };
    if (document.readyState === 'complete') whenIdle();
    else window.addEventListener('load', whenIdle);
  }
})();
