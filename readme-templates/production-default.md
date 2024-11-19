<!--- For standard PRs to production branch that will be deployed to production instances on merge -->
# Release Candidate
This is a release candidate for production deployment to our production instances. Please be sure to follow the checklist below and be prepared to rollback the deployment if necessary in [Heroku Rollback](https://dashboard.heroku.com/apps/grain-admin/activity). 
## Checklist before merging
 - [ ] Have all required checks passed?
 - [ ] Have all **environment variables** (*if any*) been added to production and staging?
 - [ ] If **Backend Dependency** label applied to any PR in this RC, did you sync with backend before rolling this out?
    - *If there is a Backend Dependency ensure that the reliant backend changes have been deployed first*