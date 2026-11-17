# Public source package

This repository contains application code, database migrations and regression tests, including the ticket refund and fraud accounting fixes.

Seed records containing contacts, employee/payroll examples, financial histories, game account details and subscription credentials have been removed. Seed arrays are intentionally empty, and the employee form has no hardcoded password. Synthetic test fixtures remain for regression testing.

Configure Supabase using `.env.example`. Never commit `.env`, service-role keys, real customer exports or account credentials. Existing hosted database records and the current live deployment are not changed by preparing this repository.
