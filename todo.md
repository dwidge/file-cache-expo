2

we need another 2 lists similar to pending ids, called recentIds and mountedIds.
whenever an id is mounted with useItem, its id must be added to top of these lists. recentIds list must also have a limit param, maybe maxRecent: number.
if all hooks using an id become unmounted, that id is removed from mountedIds.
the cacheable ids need to be managed, whenever they change or the limit changes etc.
new ids data need to be fetched with downloadFile, or deleted if their id disappears from list, but of course dont delete them if they appear in pending list or recentIds.
maybe create 2 helper hooks in module scope, with all needed params, then call these in provider.
one hook is for freeing up space in the cache, for ids that disappear in the lists or go beyond the list limits.
maybe use a useEffect ? it must manage the cache, deleting dataUris for ids in the 3 lists.
the other hook is for managing mountedIds with isOnline.
this auto fetches with downloadFile and adds to cache with setUri, the ids in mountedIds whose ids are not in cachedFileIds.
so both these hooks help manage adding / evicting items.

In useItem, the item id is currently mounted, so it has high priority to fetch into cache. useItem should add the id to mountedIds and to top of recentIds list whenever it gets remounted.
hint: make a helper for adding an id to top and updating recentIds which takes the maxRecent limit into account.
hint: make a helper for managing mountedList. this list is all ids currently in use, its similar to recentIds but drops ids immediately when they are unmounted. recentIds doesnt, it keeps older ids until its limit.
Because its in that mounted list, the live cache manager hook will
check if the id's dataUri does not exist in cache (id is not in cachedFileIds), then it must try fetch the data into cache.
it will use downloadFile to fetch it and add it to cache using cacheStorage.storage.setUri()
Because it gets added to cache, the cachedFileIds will update and now include its id.
Then dataUri from useLocalUri with that id will update itself to reflect cached datauri automatically.
note: the live cache manager does not wait for sync trigger to fetch items in mounted list, because mounted list is everything the user is seeing right now, so if
network is online (if isOnline===true) it should try fetch these ids in mounted list.
the cache manager should boot dataUris which are not in mountedIds and are too old, beyond the recentLimit/maxItemsToCache limits of their respective lists. recent list count has priority over cacheable list.

1

when syncing up, pending list ids needs to be uploaded from cache one by one, or maybe in parallel with a max concurrent limit
when a pending is uploaded, remove it from the pending id list, but it remains in cache for now
when syncing down, after all pending are done, cache must also be filled with latest files it does not have (first come first serve in the ordered list)
until full or no more to fetch. if max items changes it must handle that too.

the useFileCache hooks need to use cache, then when you sync(), sync() will upload/fetch between cache/remote
it returns null if the data for that id is not in cache.
cache has a max size, when an item is added (using the setter of useFileCache) and is over limit, need to delete last one in cacheable list which is not in pending list
if all are in pending list, and need space to add one more, throw error
pending has priority over cache, but it will throw when unable delete a cache item (because all are pending) to add more
yes, if all cache items are pending, their ids are all listed in pending id list, it means cache is full of only pending items, and nothing can be evicted
therefore, if trying to set yet another id's data, it needs to throw error saying too full.
pending means this copy of the file is the only one in existance, important not to lose it before uploading to server!
if an id disappears from cacheable list, or moves down past limit of maxItemsToCache-pendingCount, remove it from cache
if a new id appears in cacheable list, and is above limit of maxItemsToCache-pendingCount, add it to cache
new ids may also push older ones down past the limit, it must add/evict as needed to keep in sync with the list
there is also a special case, useFileCache is mounted somewhere, but asking for an id not in cache.
so, we need 3 levels/pecking orders - pending items are most important in cache (even when not current;y mounted),
followed by all currently mounted hooks, then fill remaining cache item limit with cacheable list.
note, dont count duplicates, of course.
it must also not delete items from cache needlessly if limit has not been reached.
maybe similar tp a local pending id list, we need a local recent id list, ordered by most recent mounted? it could help in deciding what to keep/evict
because the cacheable list is just a straight ordered list of latest files existing on the server, it doesnt depend on how frequent/recent a file was accessed.

write the readme as a detailed design doc markdown explaining all the nuances, try organize the doc nicely easy to understand but detailed
add any of these missing details to the jdocs and function bodies/interfaces, and try split up the logic into well named sub functions
also its preferred to have most helper functions in module scope, and give them params and ts generics if needed.
but be reasonable with this, sometimes its appropriate/shorter to have a few in the hook.

we also need a better system for progress and aborting. maybe make a standard object to pass along to child functions.
progress also needs to estimate remaining tasks and report that. there needs to be a way to report the estimated tasks as soon as possible.
its nice to let child processes handle their own reporting, but how to get a child to report its estimate up front before you call it?
are there different design patterns for this? which is best here for a react app?
it needs to be elegant and not create spaghetti.
we need a pattern to use for more than just this file cacher.
we can standardize any long running task in our app, with a progress bar and cancel button.
