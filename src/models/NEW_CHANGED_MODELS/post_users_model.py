from config import db
from datetime import datetime


class PostUser(db.Model):
    __tablename__ = "post_users"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    platform = db.Column(db.String(20), nullable=False)
    platform_user_id = db.Column(db.String(100), nullable=False)
    username = db.Column(db.String(255))
    display_name = db.Column(db.String(255), nullable=False)
    bio_description = db.Column(db.Text)
    profile_image_url = db.Column(db.Text)
    banner_image_url = db.Column(db.Text)
    website_url = db.Column(db.String(500))
    location = db.Column(db.String(255))
    followers_count = db.Column(db.BigInteger)
    following_count = db.Column(db.BigInteger)
    posts_count = db.Column(db.Integer)
    total_engagement = db.Column(db.BigInteger)
    is_verified = db.Column(db.Boolean)
    is_private = db.Column(db.Boolean)
    is_business = db.Column(db.Boolean)
    account_status = db.Column(db.String(50))
    platform_specific_data = db.Column(db.Text)
    profile_created_at = db.Column(db.DateTime)
    last_post_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # NEW FIELDS from your webhook data
    is_blue_verified = db.Column(db.Boolean)  # Twitter Blue verification
    verified_type = db.Column(db.String(50))  # Government, Business, etc.
    favourites_count = db.Column(db.BigInteger)  # Total likes given
    media_count = db.Column(db.Integer)  # Total media posted
    statuses_count = db.Column(db.Integer)  # Same as posts_count but keeping both
    fast_followers_count = db.Column(db.Integer)
    has_custom_timelines = db.Column(db.Boolean)
    is_translator = db.Column(db.Boolean)
    can_dm = db.Column(db.Boolean)
    can_media_tag = db.Column(db.Boolean)
    possibly_sensitive = db.Column(db.Boolean)
    pinned_tweet_ids = db.Column(db.Text)  # JSON array
    withheld_in_countries = db.Column(db.Text)  # JSON array
    is_automated = db.Column(db.Boolean)
    automated_by = db.Column(db.String(255))

    def to_dict(self):
        return {
            "id": self.id,
            "platform": self.platform,
            "platform_user_id": self.platform_user_id,
            "username": self.username,
            "display_name": self.display_name,
            "bio_description": self.bio_description,
            "profile_image_url": self.profile_image_url,
            "banner_image_url": self.banner_image_url,
            "website_url": self.website_url,
            "location": self.location,
            "followers_count": self.followers_count,
            "following_count": self.following_count,
            "posts_count": self.posts_count,
            "total_engagement": self.total_engagement,
            "is_verified": self.is_verified,
            "is_private": self.is_private,
            "is_business": self.is_business,
            "account_status": self.account_status,
            "platform_specific_data": self.platform_specific_data,
            "profile_created_at": str(self.profile_created_at) if self.profile_created_at else None,
            "last_post_at": str(self.last_post_at) if self.last_post_at else None,
            "created_at": str(self.created_at) if self.created_at else None,
            "updated_at": str(self.updated_at) if self.updated_at else None,
            "is_blue_verified": self.is_blue_verified,
            "verified_type": self.verified_type,
            "favourites_count": self.favourites_count,
            "media_count": self.media_count,
            "statuses_count": self.statuses_count,
            "fast_followers_count": self.fast_followers_count,
            "has_custom_timelines": self.has_custom_timelines,
            "is_translator": self.is_translator,
            "can_dm": self.can_dm,
            "can_media_tag": self.can_media_tag,
            "possibly_sensitive": self.possibly_sensitive,
            "pinned_tweet_ids": self.pinned_tweet_ids,
            "withheld_in_countries": self.withheld_in_countries,
            "is_automated": self.is_automated,
            "automated_by": self.automated_by
        }