output "endpoint" {
  description = "RDS instance endpoint (host:port)"
  value       = aws_db_instance.main.endpoint
}

output "address" {
  description = "RDS instance address"
  value       = aws_db_instance.main.address
}

output "port" {
  description = "RDS instance port"
  value       = aws_db_instance.main.port
}

output "connection_string" {
  description = "PostgreSQL connection string (password must be provided separately)"
  value       = "postgresql://${var.database_username}:${var.database_password}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.database_name}"
  sensitive   = true
}

output "security_group_id" {
  description = "RDS security group ID"
  value       = aws_security_group.rds.id
}
