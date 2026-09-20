-- Contact details become something a holder hands over, rather than
-- something publishing a card hands over on their behalf.
--
-- The page shows contact details to your own section, but this service
-- cannot enforce that rule: knowing who is in which section means knowing
-- the seat ladder, and a second copy of the ladder here would drift from the
-- page's the first time either changed. So what reaches the directory
-- reaches every signed-in holder, and the honest thing is to let people
-- choose that rather than to imply a narrower audience than there is.
--
-- Default 0: cards that exist already keep their name and role in the
-- directory and stop publishing their email until somebody says otherwise.

ALTER TABLE profiles ADD COLUMN share_contact INTEGER NOT NULL DEFAULT 0;
