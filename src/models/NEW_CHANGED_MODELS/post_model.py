from config import db
from datetime import datetime


class PostBank(db.Model):
    __tablename__ = "post_bank"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    analysisStatus = db.Column("analysisStatus", db.String(20), default="NOT_ANALYZED")
    attachments = db.Column(db.Text)
    authorName = db.Column("author_name", db.String(255), nullable=False)
    authorUsername = db.Column("author_username", db.String(255), nullable=False)
    bookmarks = db.Column(db.Integer)
    categoryId = db.Column("category_id", db.String(255))
    channelId = db.Column("channel_id", db.String(255))
    comments = db.Column(db.Integer)
    coreSource = db.Column("core_source", db.String(255))
    duration = db.Column(db.String(20))
    keyword = db.Column(db.String(255))
    likes = db.Column(db.Integer)
    mentionHashtags = db.Column("mention_hashtags", db.Text)
    mentionIds = db.Column("mention_ids", db.Text)
    photoAttachment = db.Column("photo_attachment", db.String(255))
    postDate = db.Column("post_date", db.Date)
    postId = db.Column("post_id", db.String(255))
    postLanguage = db.Column("post_language", db.String(255))
    postLocation = db.Column("post_location", db.String(255))
    postSnippet = db.Column("post_snippet", db.Text, nullable=False)
    postTime = db.Column("post_time", db.Time)
    postTimestamp = db.Column("post_timestamp", db.DateTime)
    postTitle = db.Column("post_title", db.Text, nullable=False)
    postType = db.Column("post_type", db.String(100))
    postUrl = db.Column("post_url", db.Text, nullable=False)
    retweets = db.Column(db.Integer)
    source = db.Column(db.String(255), nullable=False, default="twitter")
    uniqueHash = db.Column("unique_hash", db.String(255))
    videoAttachment = db.Column("video_attachment", db.String(255))
    videoId = db.Column("video_id", db.String(255))
    views = db.Column(db.BigInteger)
    quotedOrReplyLink = db.Column("quoted_or_reply_link", db.String(255))
    ruleId = db.Column("rule_id", db.String(255))
    tweetType = db.Column("tweet_type", db.String(255))
    createBy = db.Column("create_by", db.String(255))
    tag = db.Column("tag", db.String(255))
    author_user_id = db.Column("author_user_id", db.Integer)  # NEW FIELD
    searched_term = db.Column("searched_term", db.Text)  # NEW FIELD for search query Rahul bhaiya walaa h ye
    query_tag = db.Column("query_tag", db.String(500))  # NEW FIELD for query tag recycling
    replies_since_id = db.Column("replies_since_id", db.String(255))  # NEW FIELD for replies pagination
    # rule Tag New column added
    ruleTag = db.Column("rule_tag", db.Text, nullable=False)

    # ------------------ NEW FIELDS ------------------
    # conversationId = db.Column("conversation_id", db.String(255))  # conversationId
    inReplyToId = db.Column("in_reply_to_id", db.String(255))  # inReplyToId
    inReplyToUserId = db.Column("in_reply_to_user_id", db.String(255))  # inReplyToUserId
    inReplyToUsername = db.Column("in_reply_to_username", db.String(255))  # inReplyToUsername
    isReply = db.Column("is_reply", db.Boolean)  # isReply
    displayTextRange = db.Column("display_text_range", db.String(50))  # displayTextRange as "start-end"
    deviceSource = db.Column("device_source", db.String(255))  # source (raw device)
    extendedEntities = db.Column("extended_entities", db.Text)  # extendedEntities JSON
    # card = db.Column("card", db.Text)  # card JSON
    # place = db.Column("place", db.Text)  # place JSON
    possiblySensitive = db.Column("possibly_sensitive", db.Boolean)  # possiblySensitive
    pinnedTweetIds = db.Column("pinned_tweet_ids", db.Text)  # pinnedTweetIds as JSON
    isLimitedReply = db.Column("is_limited_reply", db.Boolean)  # isLimitedReply
    article = db.Column("article", db.Text)  # article JSON

    def to_dict(self):
        return {
            "id": self.id,
            "analysisStatus": self.analysisStatus,
            "attachments": self.attachments,
            "authorName": self.authorName,
            "authorUsername": self.authorUsername,
            "bookmarks": self.bookmarks,
            "categoryId": self.categoryId,
            "channelId": self.channelId,
            "comments": self.comments,
            "coreSource": self.coreSource,
            "duration": self.duration,
            "keyword": self.keyword,
            "likes": self.likes,
            "mentionHashtags": self.mentionHashtags,
            "mentionIds": self.mentionIds,
            "photoAttachment": self.photoAttachment,
            "postDate": str(self.postDate) if self.postDate else None,
            "postId": self.postId,
            "postLanguage": self.postLanguage,
            "postLocation": self.postLocation,
            "postSnippet": self.postSnippet,
            "postTime": str(self.postTime) if self.postTime else None,
            "postTimestamp": str(self.postTimestamp) if self.postTimestamp else None,
            "postTitle": self.postTitle,
            "postType": self.postType,
            "postUrl": self.postUrl,
            "retweets": self.retweets,
            "source": self.source,
            "uniqueHash": self.uniqueHash,
            "videoAttachment": self.videoAttachment,
            "videoId": self.videoId,
            "views": self.views,
            "quotedOrReplyLink": self.quotedOrReplyLink,
            "ruleId": self.ruleId,
            "tweetType": self.tweetType,
            "createBy": self.createBy,
            "tag": self.tag,
            "author_user_id": self.author_user_id,
            "searched_term": self.searched_term,
            "query_tag": self.query_tag,
            "replies_since_id": self.replies_since_id,
            "ruleTag": self.ruleTag,
            # "conversationId": self.conversationId,
            "inReplyToId": self.inReplyToId,
            "inReplyToUserId": self.inReplyToUserId,
            "inReplyToUsername": self.inReplyToUsername,
            "isReply": self.isReply,
            "displayTextRange": self.displayTextRange,
            "deviceSource": self.deviceSource,
            "extendedEntities": self.extendedEntities,
            # "card": self.card,
            # "place": self.place,
            "possiblySensitive": self.possiblySensitive,
            "pinnedTweetIds": self.pinnedTweetIds,
            "isLimitedReply": self.isLimitedReply,
            "article": self.article,

        }
