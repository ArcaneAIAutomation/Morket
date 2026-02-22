terraform {
  backend "s3" {
    bucket         = "morket-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "morket-terraform-locks"
    encrypt        = true
  }
}
