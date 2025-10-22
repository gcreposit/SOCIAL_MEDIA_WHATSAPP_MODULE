from config import db
from datetime import datetime


class CommonAttachment(db.Model):
    __tablename__ = "common_attachments"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    # Foreign key to PostBank
    post_bank_id = db.Column(db.Integer, db.ForeignKey('post_bank.id'), nullable=False, comment='References the post_bank record this attachment belongs to')

    # Attachment metadata
    attachment_type = db.Column(db.String(50), nullable=False, comment='Type of attachment: image, video, audio, document, link, batch')
    platform_name = db.Column(db.String(50), nullable=False, comment='Source platform of the attachment')

    # Paths for different attachment types
    image_attachment_path = db.Column(db.Text, nullable=True)
    document_attachment_path = db.Column(db.Text, nullable=True)
    video_attachment_path = db.Column(db.Text, nullable=True)
    audio_attachment_path = db.Column(db.Text, nullable=True)

    # Metadata fields
    link_metadata = db.Column(db.Text, nullable=True)

    # Reply attachment info (reserved for future use)
    reply_attachment_type = db.Column(db.String(50), nullable=True)
    reply_attachment_path = db.Column(db.Text, nullable=True)

    # File info
    mime_type = db.Column(db.String(100), nullable=True)

    # Original message timestamp (store IST for consistency with PostBank)
    timestamp = db.Column(db.DateTime, nullable=True)

    # Optional fields (primarily for WhatsApp; kept for compatibility)
    group_id = db.Column(db.String(100), nullable=True)
    mobile_number = db.Column(db.String(20), nullable=True)

    # Status fields
    download_status = db.Column(db.String(20), default='PENDING')
    processing_status = db.Column(db.String(20), default='NOT_PROCESSED')
    error_message = db.Column(db.Text, nullable=True)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    post_bank = db.relationship('PostBank', backref='common_attachments')

    def to_dict(self):
        return {
            'id': self.id,
            'post_bank_id': self.post_bank_id,
            'attachment_type': self.attachment_type,
            'platform_name': self.platform_name,
            'image_attachment_path': self.image_attachment_path,
            'document_attachment_path': self.document_attachment_path,
            'video_attachment_path': self.video_attachment_path,
            'audio_attachment_path': self.audio_attachment_path,
            'link_metadata': self.link_metadata,
            'reply_attachment_type': self.reply_attachment_type,
            'reply_attachment_path': self.reply_attachment_path,
            'mime_type': self.mime_type,
            'timestamp': str(self.timestamp) if self.timestamp else None,
            'group_id': self.group_id,
            'mobile_number': self.mobile_number,
            'download_status': self.download_status,
            'processing_status': self.processing_status,
            'error_message': self.error_message,
            'created_at': str(self.created_at) if self.created_at else None,
            'updated_at': str(self.updated_at) if self.updated_at else None,
        }