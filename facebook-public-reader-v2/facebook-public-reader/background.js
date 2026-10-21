chrome.action.onClicked.addListener(async tab => {
  if (!tab.id || !/^https:\/\/www\.facebook\.com\//.test(tab.url || '')) {
    await chrome.action.setBadgeText({tabId: tab.id, text: 'FB'});
    return;
  }
  try {
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['core.js', 'reader.js']});
    await chrome.action.setBadgeText({tabId: tab.id, text: ''});
  } catch (error) {
    console.error('Reader could not open', error);
    await chrome.action.setBadgeText({tabId: tab.id, text: '!'});
  }
});
